import { Inject, Injectable, Optional } from '@nestjs/common';
import { TRIGGER_DECIDERS } from './triggers.decorators';
@Injectable() export class ProviderTriggersService { constructor(@Optional() @Inject(TRIGGER_DECIDERS) readonly deciders?: unknown) {} }