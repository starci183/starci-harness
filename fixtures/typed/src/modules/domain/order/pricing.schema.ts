import { Injectable } from "@nestjs/common"

export const priceOf = (cents: number): number => cents * 2

@Injectable()
export class PricingRules {
    static apply(cents: number): number {
        return priceOf(cents) + 1
    }
}
