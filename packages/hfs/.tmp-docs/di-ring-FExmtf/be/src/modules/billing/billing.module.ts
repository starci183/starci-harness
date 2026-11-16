import { Global, Module } from '@nestjs/common';
import { TRIGGER_DECIDERS } from '@modules/triggers';
import { BankFeedDeciderService } from './bank-feed-decider.service';
import { BankFeedTriggerService } from './bank-feed-trigger.service';
@Global() @Module({ providers: [BankFeedTriggerService, BankFeedDeciderService, { provide: TRIGGER_DECIDERS, useExisting: BankFeedTriggerService }], exports: [TRIGGER_DECIDERS] })
export class BillingModule {}