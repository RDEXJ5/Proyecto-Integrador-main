export function hasRole(user, role) {
  return user.roles.some((entry) => entry.code === role);
}

export function hasAnyRole(user, roles) {
  return roles.some((role) => hasRole(user, role));
}

export function hasPermission(user, permission) {
  return (user.permissions ?? []).includes(permission);
}

export function hasAnyPermission(user, permissions) {
  return permissions.some((permission) => hasPermission(user, permission));
}

export function isTechnicalOnly(user) {
  return hasRole(user, 'admin')
    && !hasAnyPermission(user, ['case.read.assigned', 'case.read.unit', 'case.read.audit']);
}

export function canAccessOwnParticipantDocumentsOnly(user) {
  const hasBroaderRole = hasAnyRole(user, [
    'notary', 'judge', 'lawyer', 'prosecutor', 'defender', 'expert',
    'secretary', 'coordinator', 'auditor'
  ]);
  return !hasBroaderRole && hasAnyRole(user, ['party', 'witness']);
}

export function canSeeHiddenLegalRecords(user) {
  return hasAnyPermission(user, ['case.read.audit', 'case.visibility.manage']);
}

export function isAllowedChannel(user, channel) {
  return user.roles.some((entry) => entry.channel === channel);
}
