import { Module } from "@nestjs/common"
import { @@Feature@@ApiModule } from "../../@@feature@@.module"
import { @@Action@@Controller } from "./@@action@@.controller"
import { ConfigurableModuleClass } from "./@@feature@@-http.module-definition"

@Module({ imports: [@@Feature@@ApiModule.register({})], controllers: [@@Action@@Controller] })
/** The HTTP transport of the @@feature@@ feature: the REST doors of its operations. */
export class @@Feature@@HttpModule extends ConfigurableModuleClass {}
