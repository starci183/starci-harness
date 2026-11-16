import { Module } from '@nestjs/common';
import { TriggersModule } from '@modules/triggers';
import { BillingModule } from '@modules/billing/billing.module';
@Module({ imports: [TriggersModule, BillingModule] }) export class AppModule {}