import { applyDecorators, SetMetadata } from '@nestjs/common'
import { ApiExtension } from '@nestjs/swagger'
import { UserRole } from '@prisma/client'

export const ROLES_KEY = 'roles'
// x-roles mirrors RolesGuard (method roles override controller roles) so the OpenAPI spec lists who may call each operation.
export const Roles = (...roles: UserRole[]) => applyDecorators(SetMetadata(ROLES_KEY, roles), ApiExtension('x-roles', roles))
