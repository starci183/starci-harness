{
  "extends": "@starci/tsconfig/package-cjs.json",
  "compilerOptions": {
    "types": ["node", "jest"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
