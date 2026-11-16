import { Injectable } from '@nestjs/common';
import { ProviderTriggersService } from '@modules/triggers';
import { BankFeedDeciderService } from './bank-feed-decider.service';
@Injectable() export class BankFeedTriggerService { constructor(readonly triggers: ProviderTriggersService, readonly decider: BankFeedDeciderService) {} }