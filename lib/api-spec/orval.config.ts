import { defineConfig, InputTransformerFn } from "orval";
import path from "path";

const root = path.resolve(__dirname, "..", "..");
const apiClientReactSrc = path.resolve(root, "lib", "api-client-react", "src");
const apiZodSrc = path.resolve(root, "lib", "api-zod", "src");

// Our exports make assumptions about the title of the API being "Api" (i.e. generated output is `api.ts`).
const titleTransformer: InputTransformerFn = (config) => {
  config.info ??= {};
  config.info.title = "Api";
  // Orval does not reliably expand inherited parameter references when building
  // fetch URLs. Material markup requires companyId on every super-admin call.
  for (const pathItem of Object.values(config.paths ?? {})) {
    if (!pathItem || "$ref" in pathItem) continue;
    const expand = (parameter: any) => parameter.$ref?.startsWith("#/components/parameters/")
      ? config.components?.parameters?.[parameter.$ref.split("/").pop()!] ?? parameter : parameter;
    const inherited = (pathItem.parameters ?? []).map(expand);
    for (const method of ["get", "post", "put", "patch", "delete"] as const) {
      const operation = pathItem[method];
      if (operation) operation.parameters = [...inherited, ...(operation.parameters ?? []).map(expand)];
    }
    delete pathItem.parameters;
  }

  return config;
};

export default defineConfig({
  "api-client-react": {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiClientReactSrc,
      target: "generated",
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      prettier: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: path.resolve(apiClientReactSrc, "custom-fetch.ts"),
          name: "customFetch",
        },
      },
    },
  },
  zod: {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiZodSrc,
      client: "zod",
      target: "generated",
      schemas: { path: "generated/types", type: "typescript" },
      mode: "split",
      clean: true,
      prettier: true,
      override: {
        zod: {
          coerce: {
            query: ['boolean', 'number', 'string'],
            param: ['boolean', 'number', 'string'],
            body: ['bigint', 'date'],
            response: ['bigint', 'date'],
          },
        },
        useDates: true,
        useBigInt: true,
        operations: {
          getMarkupSchedule: { zod: { generate: { param: false } } },
          updateMarkupSchedule: { zod: { generate: { param: false } } },
          activateMarkupSchedule: { zod: { generate: { param: false } } },
          deactivateMarkupSchedule: { zod: { generate: { param: false } } },
          getCustomerMarkupOverride: { zod: { generate: { param: false } } },
          setCustomerMarkupOverride: { zod: { generate: { param: false } } },
          removeCustomerMarkupOverride: { zod: { generate: { param: false } } },
          // Orval names the path Zod schema and query TS type *Params when
          // an operation has both. This route reuses the irrigation ID parser.
          getDocumentationSite: { zod: { generate: { param: false } } },
          getInvoiceBatch: { zod: { generate: { param: false } } },
          confirmDocumentationNoBackflow: { zod: { strict: { body: true } } },
          verifyDocumentationSite: { zod: { strict: { body: true } } },
        },
      },
    },
  },
});
