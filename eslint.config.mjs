// minimal flat config - next build runs its own internal lint pass
// keeping this file lightweight to avoid eslintrc/flat compat issues with eslint-config-next
export default [
  {
    ignores: [".next/**", "node_modules/**", "drizzle/**"],
  },
];
