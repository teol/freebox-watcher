import 'dotenv/config';
import { NotificationService } from '../services/notification.js';
import { logger } from '../utils/logger.js';

async function main(): Promise<void> {
    const notificationService = new NotificationService(logger);

    if (!notificationService.isEnabled()) {
        logger.warn('Telegram notifications disabled: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured');
        return;
    }

    await notificationService.sendTestNotification();
}

void main();
