/** Fixture signatures retain class-validator ownership for cross-file decorator checks. */
declare module "class-validator" {
    export function IsUUID(): PropertyDecorator
    export function IsString(): PropertyDecorator
    export function IsOptional(): PropertyDecorator
    export function ValidateIf(condition: () => boolean): PropertyDecorator
    export function MinLength(length: number): PropertyDecorator
    export function MaxLength(length: number): PropertyDecorator
}
