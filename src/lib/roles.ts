import type { UserRole } from './types';

export const USER_ROLES: readonly UserRole[] = ['Citizen', 'Officer', 'Department Admin', 'Super Admin'] as const;
export const OFFICER_ROLES: readonly UserRole[] = ['Officer', 'Department Admin', 'Super Admin'] as const;
export const ADMIN_ROLES: readonly UserRole[] = ['Department Admin', 'Super Admin'] as const;

export function isUserRole(value: string): value is UserRole {
  return USER_ROLES.includes(value as UserRole);
}

export function canPerformOfficerAction(role: UserRole | null | undefined) {
  return !!role && OFFICER_ROLES.includes(role);
}

export function canPerformAdminAction(role: UserRole | null | undefined) {
  return !!role && ADMIN_ROLES.includes(role);
}
