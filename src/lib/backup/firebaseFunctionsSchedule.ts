/**
 * Firebase Functions 2nd Gen Deployable Schedule Integration
 * 
 * Deployment Instructions:
 * 1. Ensure Firebase CLI is logged in and configured.
 * 2. Deploy using: firebase deploy --only functions:scheduledDailyBackup
 * 3. Environment Variables required in Cloud Secret Manager / Cloud Run:
 *    - BACKUP_BUCKET: e.g. "stokpro-private-backups"
 *    - BACKUP_CRON_SECRET: Secret token for webhook triggers
 * 
 * Frequency: Every night at 02:00 Europe/Istanbul time (0 2 * * *)
 */

export interface FirebaseScheduleConfig {
  schedule: string;
  timeZone: string;
  retryConfig: {
    retryCount: number;
    minBackoffSeconds: number;
    maxBackoffSeconds: number;
  };
  memory: "512MiB" | "1GiB";
  timeoutSeconds: number;
}

export const FIREBASE_SCHEDULE_CONFIG: FirebaseScheduleConfig = {
  schedule: "0 2 * * *", // 02:00 every night
  timeZone: "Europe/Istanbul",
  retryConfig: {
    retryCount: 3,
    minBackoffSeconds: 10,
    maxBackoffSeconds: 300
  },
  memory: "512MiB",
  timeoutSeconds: 300 // 5 minutes max execution time
};

/**
 * Standard Firebase Functions 2nd Gen Schedule Definition
 * (Executable in Node.js 18/20/22 Cloud Functions environment)
 */
export const SCHEDULE_FUNCTION_CODE_SNIPPET = `
import { onSchedule } from "firebase-functions/v2/scheduler";
import { scheduledBackupRunner } from "./src/lib/backup/ScheduledBackupRunner";

export const scheduledDailyBackup = onSchedule(
  {
    schedule: "0 2 * * *",
    timeZone: "Europe/Istanbul",
    retryCount: 3,
    memory: "512MiB",
    timeoutSeconds: 300
  },
  async (event) => {
    console.log("[Firebase Scheduler] Triggering automatic daily tenant backup cycle...");
    const report = await scheduledBackupRunner.runScheduledCycle({
      initiatedBy: "scheduler"
    });
    console.log("[Firebase Scheduler] Backup finished with status:", report.status, report.message);
  }
);
`;
