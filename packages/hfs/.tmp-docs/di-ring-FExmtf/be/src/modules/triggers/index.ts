import { Global, Module } from '@nestjs/common';
import { ProviderTriggersService } from './provider-triggers.service';
export { ProviderTriggersService } from './provider-triggers.service';
export { TRIGGER_DECIDERS } from './triggers.decorators';
@Global() @Module({ providers: [ProviderTriggersService], exports: [ProviderTriggersService] }) export class TriggersModule {}