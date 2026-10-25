import { Module } from '@nestjs/common'
import { NotificationsService } from './notifications.service'
import { WorkflowNotifier } from './workflow-notifier.service'

@Module({
  providers: [NotificationsService, WorkflowNotifier],
  exports: [NotificationsService, WorkflowNotifier],
})
export class NotificationsModule {}
