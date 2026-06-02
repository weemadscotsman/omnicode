export enum Role {
  Admin = 'Admin',
  Developer = 'Developer',
  ReadOnly = 'Read-Only',
}

export enum Permission {
  IndexCode = 'index:code',
  SearchSymbols = 'search:symbols',
  ManageRoles = 'manage:roles',
  ViewLogs = 'view:logs',
}

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.Admin]: [
    Permission.IndexCode,
    Permission.SearchSymbols,
    Permission.ManageRoles,
    Permission.ViewLogs,
  ],
  [Role.Developer]: [Permission.IndexCode, Permission.SearchSymbols],
  [Role.ReadOnly]: [Permission.SearchSymbols],
};

export function hasPermission(role: string, permission: Permission): boolean {
  const typedRole = role as Role;
  return ROLE_PERMISSIONS[typedRole]?.includes(permission) ?? false;
}
