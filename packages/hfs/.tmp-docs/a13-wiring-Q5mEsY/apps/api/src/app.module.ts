import { Module } from '@nestjs/common'; import { CapabilityModule } from '@modules/capability';
@Module({ imports: [CapabilityModule] }) export class AppModule {}