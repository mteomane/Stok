import express from "express";
import path from "path";
import fs from "fs/promises";
import { createServer as createViteServer } from "vite";
import { 
  paymentService, 
  PaymentProviderType, 
  WebhookEventType,
  CustomerBillingInfo 
} from "./src/lib/payment";
import { cloudBackupService } from "./src/lib/backup/CloudBackupService";
import { scheduledBackupRunner } from "./src/lib/backup/ScheduledBackupRunner";

interface PaymentStore {
  subscriptions: Record<string, any>;
  payments: any[];
}

const DATA_FILE = path.join(process.cwd(), "data", "payment_store.json");

const defaultStore: PaymentStore = {
  subscriptions: {},
  payments: []
};

async function readStore(): Promise<PaymentStore> {
  try {
    const data = await fs.readFile(DATA_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return defaultStore;
  }
}

async function writeStore(store: PaymentStore): Promise<void> {
  try {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2));
  } catch (err) {
    console.warn("Could not persist payment store to disk:", err);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    }
  }));

  // ==========================================
  // PAYMENT PROVIDER AGNOSTIC API ROUTES
  // ==========================================

  // A. Public Safe Configuration (No Secrets Leaked!)
  app.get("/api/payment/config", (req, res) => {
    const safeConfig = paymentService.getSafeConfig();
    res.json({
      ...safeConfig,
      availableProviders: ["mock", "iyzico", "paytr"],
      activeProvider: safeConfig.provider
    });
  });

  // B. Switch Active Provider (Sandbox / Multi-Provider switch)
  app.post("/api/payment/set-provider", (req, res) => {
    try {
      if (process.env.NODE_ENV === "production") {
        return res.status(403).json({
          error: "Güvenlik Engeli: Ödeme sağlayıcı ayarı üretim (production) ortamında API üzerinden dinamik olarak değiştirilemez."
        });
      }

      const { provider } = req.body;
      if (!provider || !["mock", "iyzico", "paytr"].includes(provider)) {
        return res.status(400).json({ error: "Geçersiz sağlayıcı. 'mock', 'iyzico' veya 'paytr' seçilebilir." });
      }
      paymentService.setProvider(provider as PaymentProviderType);
      res.json({ 
        message: `Aktif ödeme sağlayıcı başarıyla '${provider}' olarak değiştirildi.`,
        config: paymentService.getSafeConfig()
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Sağlayıcı değiştirilemedi." });
    }
  });

  // C. Create Checkout Session (Provider-Agnostic)
  app.post("/api/payment/checkout", async (req, res) => {
    try {
      const { tenantId, planId, billingPeriod, amount, customer, returnUrl, cancelUrl, metadata } = req.body;
      if (!tenantId || !planId || amount === undefined) {
        return res.status(400).json({ error: "tenantId, planId ve amount alanları zorunludur." });
      }

      const defaultCustomer: CustomerBillingInfo = {
        name: customer?.name || "İşletme Yetkilisi",
        email: customer?.email || "yonetici@ornekisletme.com",
        phone: customer?.phone || "+905551234567",
        address: customer?.address || "İstanbul, Türkiye",
        taxOffice: customer?.taxOffice || "Şişli",
        taxNumber: customer?.taxNumber || "1234567890"
      };

      const session = await paymentService.createCheckout({
        tenantId,
        planId,
        billingPeriod: billingPeriod === "yearly" ? "yearly" : "monthly",
        amount: Number(amount),
        currency: "TRY",
        customer: defaultCustomer,
        returnUrl,
        cancelUrl,
        metadata
      });

      res.status(201).json(session);
    } catch (err: any) {
      console.error("Checkout creation error:", err);
      res.status(500).json({ error: err.message || "Ödeme oturumu oluşturulamadı." });
    }
  });

  // D. Production Webhook Receiver (HMAC Verification, Idempotency & State Machine)
  app.post("/api/payment/webhook", async (req, res) => {
    try {
      const rawBody = (req as any).rawBody || JSON.stringify(req.body);
      const headers = req.headers;

      const { statusCode, result } = await paymentService.processWebhook(rawBody, headers, req.body);

      // If webhook resulted in a verified state change, update backend store
      if (result.success && !result.idempotent) {
        const store = await readStore();
        const tenantId = result.tenantId || req.body?.data?.tenantId || req.body?.tenantId;

        if (tenantId) {
          const currentSub = store.subscriptions[tenantId] || {
            tenantId,
            planId: "free",
            status: "trialing",
            startDate: new Date().toISOString(),
            endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            provider: paymentService.getProvider().name
          };

          if (result.actionTaken === "SUBSCRIPTION_ACTIVATED" || result.actionTaken === "SUBSCRIPTION_RENEWED") {
            const planId = result.details?.planId || req.body?.data?.planId || "pro";
            const billingPeriod = req.body?.data?.billingPeriod || "monthly";
            const periodDays = billingPeriod === "yearly" ? 365 : 30;
            const endDate = result.details?.endDate || new Date(Date.now() + periodDays * 24 * 60 * 60 * 1000).toISOString();

            store.subscriptions[tenantId] = {
              ...currentSub,
              planId,
              status: "active",
              startDate: new Date().toISOString(),
              endDate,
              provider: paymentService.getProvider().name,
              providerSubscriptionId: result.details?.subscriptionId || currentSub.providerSubscriptionId,
              updatedAt: new Date().toISOString()
            };

            store.payments.unshift({
              id: "PAY_" + Math.random().toString(36).substring(2, 8).toUpperCase(),
              tenantId,
              type: "incoming",
              amount: Number(req.body?.data?.amount || 0),
              paymentMethod: "kredi_karti",
              timestamp: new Date().toISOString(),
              description: `SaaS ${planId.toUpperCase()} Abonelik Ödemesi (${paymentService.getProvider().name.toUpperCase()} Webhook)`
            });
          } else if (result.actionTaken === "PAYMENT_FAILED_RECORDED") {
            store.subscriptions[tenantId] = {
              ...currentSub,
              status: "past_due",
              updatedAt: new Date().toISOString()
            };
          } else if (result.actionTaken === "SUBSCRIPTION_CANCELED") {
            store.subscriptions[tenantId] = {
              ...currentSub,
              status: "canceled",
              updatedAt: new Date().toISOString()
            };
          }

          await writeStore(store);
        }
      }

      res.status(statusCode).json(result);
    } catch (err: any) {
      console.error("Webhook processing exception:", err);
      res.status(500).json({
        success: false,
        error: "Webhook işlenirken beklenmeyen sunucu hatası oluştu."
      });
    }
  });

  // E. Developer & Test Webhook Simulator
  app.post("/api/payment/simulate-webhook", async (req, res) => {
    try {
      if (process.env.NODE_ENV === "production") {
        return res.status(403).json({
          error: "Güvenlik Engeli: Simülasyon ve test ödeme uçları üretim (production) ortamında kesinlikle devre dışıdır."
        });
      }

      const { 
        type, 
        tenantId, 
        planId, 
        amount, 
        billingPeriod, 
        failureReason,
        tamperSignature, 
        duplicateEventId 
      } = req.body;

      if (!type) {
        return res.status(400).json({ error: "type (WebhookEventType) alanı zorunludur." });
      }

      const targetTenantId = tenantId || "demo-tenant";
      const simulation = await paymentService.simulateWebhookEvent(
        type as WebhookEventType,
        {
          tenantId: targetTenantId,
          planId: planId || "pro",
          amount: amount !== undefined ? Number(amount) : 890,
          billingPeriod: billingPeriod === "yearly" ? "yearly" : "monthly",
          failureReason
        },
        {
          tamperSignature: Boolean(tamperSignature),
          duplicateEventId
        }
      );

      // If valid and not duplicate, update store
      if (simulation.result.success && !simulation.result.idempotent) {
        const store = await readStore();

        const currentSub = store.subscriptions[targetTenantId] || {
          tenantId: targetTenantId,
          planId: "free",
          status: "trialing",
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          provider: "mock"
        };

        if (simulation.result.actionTaken === "SUBSCRIPTION_ACTIVATED" || simulation.result.actionTaken === "SUBSCRIPTION_RENEWED") {
          const selectedPlan = planId || "pro";
          const period = billingPeriod === "yearly" ? 365 : 30;
          store.subscriptions[targetTenantId] = {
            ...currentSub,
            planId: selectedPlan,
            status: "active",
            startDate: new Date().toISOString(),
            endDate: new Date(Date.now() + period * 24 * 60 * 60 * 1000).toISOString(),
            provider: "mock",
            updatedAt: new Date().toISOString()
          };

          store.payments.unshift({
            id: "PAY_SIM_" + Math.random().toString(36).substring(2, 7).toUpperCase(),
            tenantId: targetTenantId,
            type: "incoming",
            amount: Number(amount || 890),
            paymentMethod: "kredi_karti",
            timestamp: new Date().toISOString(),
            description: `Simüle Edilen Webhook Ödemesi: ${selectedPlan.toUpperCase()} Planı`
          });
        } else if (simulation.result.actionTaken === "PAYMENT_FAILED_RECORDED") {
          store.subscriptions[targetTenantId] = {
            ...currentSub,
            status: "past_due",
            updatedAt: new Date().toISOString()
          };
        } else if (simulation.result.actionTaken === "SUBSCRIPTION_CANCELED") {
          store.subscriptions[targetTenantId] = {
            ...currentSub,
            status: "canceled",
            updatedAt: new Date().toISOString()
          };
        }

        await writeStore(store);
      }

      const store = await readStore();
      res.status(simulation.statusCode).json({
        ...simulation,
        activeSubscription: store.subscriptions?.[targetTenantId] || null
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Simülasyon başarısız oldu." });
    }
  });

  // F. Webhook Audit Events Feed (For UI timeline)
  app.get("/api/payment/events", (req, res) => {
    const tenantId = req.query.tenantId as string | undefined;
    const events = paymentService.getRecentEvents(tenantId);
    res.json(events);
  });

  // ==========================================
  // AUTOMATIC CLOUD BACKUP API ROUTES (FAZ 5A)
  // ==========================================

  // 1. Scheduled Daily Cron Endpoint (Secured with BACKUP_CRON_SECRET / OIDC Bearer)
  app.post("/api/backup/cron/daily", async (req, res) => {
    // Verify authorization
    const authCheck = scheduledBackupRunner.verifyCronAuthorization(req.headers);
    if (!authCheck.authorized) {
      return res.status(401).json({
        error: "Yetkisiz erişim: Zamanlanmış yedekleme anahtarı doğrulanamadı.",
        details: authCheck.reason
      });
    }

    try {
      const force = req.query.force === "true" || req.body?.force === true;
      const targetTenants = req.body?.tenants;

      const report = await scheduledBackupRunner.runScheduledCycle({
        tenants: targetTenants,
        force,
        initiatedBy: "scheduler"
      });

      if (report.status === "skipped_in_progress") {
        return res.status(409).json(report);
      }

      if (report.status === "skipped_already_run_today") {
        return res.status(200).json(report);
      }

      if (report.status === "failed") {
        return res.status(500).json(report);
      }

      res.status(200).json(report);
    } catch (err: any) {
      console.error("Scheduled backup cron error:", err);
      res.status(500).json({ error: err.message || "Yedekleme işi çalışırken beklenmeyen hata oluştu." });
    }
  });

  // 1b. Status endpoint for scheduler monitoring
  app.get("/api/backup/cron/status", (req, res) => {
    const isRunning = scheduledBackupRunner.isCurrentlyRunning();
    const lastReport = scheduledBackupRunner.getLastReport();
    res.json({
      isRunning,
      lastReport,
      timestamp: new Date().toISOString()
    });
  });

  // 2. Tenant Backup History & Status
  app.get("/api/backup/tenant/:tenantId/history", async (req, res) => {
    try {
      const { tenantId } = req.params;
      const history = await cloudBackupService.getTenantBackupHistory(tenantId);
      res.json(history);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Yedekleme geçmişi alınamadı." });
    }
  });

  // 3. Trigger Manual/Scheduled Cloud Backup for Tenant
  app.post("/api/backup/tenant/:tenantId/trigger", async (req, res) => {
    try {
      const { tenantId } = req.params;
      const result = await cloudBackupService.executeTenantBackup(
        tenantId,
        {
          getTenantData: async (id) => ({
            companyName: req.body.companyName || "İşletme",
            collections: req.body.data || {
              products: [],
              customers: [],
              suppliers: [],
              sales: [],
              warehouses: [],
              orders: [],
              payments: [],
              stockMovements: []
            }
          })
        },
        {
          initiatedBy: "manual_admin",
          frequency: "manual"
        }
      );

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Yedek tetikleme başarısız." });
    }
  });

  // ==========================================
  // SECURITY GUARD: UNHANDLED / DEPRECATED API ROUTES
  // Explicitly return 404 JSON for removed endpoints
  // (/api/products, /api/sales, /api/customers, /api/orders, etc.)
  // ==========================================
  app.all("/api/*", (req, res) => {
    res.status(404).json({
      error: "API endpoint'i bulunamadı veya güvenlik gereği kullanımdan kaldırıldı.",
      path: req.path
    });
  });

  // Vite development integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
