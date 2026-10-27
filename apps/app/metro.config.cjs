const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
// Shared targets Node ESM (.js imports) while its workspace exports TS sources.
config.resolver.resolveRequest = (context, name, platform) => {
 const origin = context.originModulePath.replace(/\\/g, '/');
 if (origin.includes('/packages/shared/') && name.startsWith('.') && name.endsWith('.js')) {
  return context.resolveRequest(context, name.slice(0, -3), platform);
 }
 return context.resolveRequest(context, name, platform);
};
module.exports = config;
