import { PermissionFlagsBits } from 'discord.js';
import { getAdminRoleId } from './premiumConfig.js';

export function hasManageGuild(source) {
    const permissions = source.memberPermissions ?? source.member?.permissions;
    return Boolean(permissions?.has?.(PermissionFlagsBits.ManageGuild));
}

export async function hasAdminAccess(source) {
    if (!source.guild?.id) return false;
    if (hasManageGuild(source)) return true;

    const roleId = await getAdminRoleId(source.guild.id);
    if (!roleId) return false;
    const roles = source.member?.roles;
    if (roles?.cache) return roles.cache.has(roleId);
    return Array.isArray(roles) && roles.includes(roleId);
}

export function adminDenied(source) {
    const ephemeral = Boolean(source.isChatInputCommand?.());
    return source.reply({
        content: 'You need the configured admin role or Manage Server permission to use this command.',
        ephemeral,
    });
}