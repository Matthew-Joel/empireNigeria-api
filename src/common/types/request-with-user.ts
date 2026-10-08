import { UserRole } from '@prisma/client'
import { Request } from 'express'

export interface AuthenticatedRequest extends Request {
  user: {
    sub: string
    email: string
    role: UserRole
  }
}
