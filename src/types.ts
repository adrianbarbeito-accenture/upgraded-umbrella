export type HttpMethod = "get" | "post" | "put" | "patch" | "delete" | "options" | "head";

export type Endpoint = {
  operationId: string;
  method: HttpMethod;
  path: string;
  tag: string;
  summary: string;
  description: string;
  parameters: Array<{
    name: string;
    in: "path" | "query" | "header" | "cookie";
    required: boolean;
    type: string;
    description: string;
  }>;
  requestBodySchemaRef?: string;
  responses: Array<{ status: string; description: string; schemaRef?: string }>;
};

export type Schema = {
  name: string;
  ref: string;
  description: string;
  properties: Array<{ name: string; type: string; required: boolean; description: string }>;
};

export type NestModule = {
  name: string;
  file: string;
  imports: string[];
  controllers: string[];
  providers: string[];
};

export type WidgetNode = {
  type: string;
  text?: string;
  children: WidgetNode[];
};

export type FlutterScreen = {
  name: string;
  file: string;
  feature: string;
  widgetTree: WidgetNode | null;
  cubits: string[];
};

export type FlutterCubit = {
  name: string;
  file: string;
  feature: string;
  states: string[];
  emits: string[];
  repositories: string[];
  /** Method names this cubit invokes on any of its dependencies (`x.foo()` → `foo`). */
  invokes: string[];
};

export type FlutterRoute = {
  name: string;
  path: string;
  screen: string;
};

export type HttpCall = {
  method: HttpMethod;
  path: string;
  file: string;
  enclosing: string;
  /** Name of the Dart method (within `enclosing`) that issues the call. */
  methodName: string;
};

export type FlutterRepository = {
  name: string;
  file: string;
  feature: string;
  calls: HttpCall[];
};

export type ParseResult = {
  backend: {
    endpoints: Endpoint[];
    schemas: Schema[];
    modules: NestModule[];
  };
  flutter: {
    pubspec: { name: string; version: string; dependencies: string[] };
    routes: FlutterRoute[];
    screens: FlutterScreen[];
    cubits: FlutterCubit[];
    /** Classes that issue HTTP calls (regardless of name). */
    repositories: FlutterRepository[];
    /** className -> other class names it references as field/parameter types. */
    classRefs: Record<string, string[]>;
  };
};

export type Flow = {
  key: string;
  title: string;
  feature: string;
  screen?: FlutterScreen;
  cubit?: FlutterCubit;
  repository?: FlutterRepository;
  endpoints: Endpoint[];
};

export type CrossLinks = {
  // operationId -> screen names that consume it
  endpointConsumers: Record<string, string[]>;
  // screen name -> operationIds it triggers
  screenEndpoints: Record<string, string[]>;
};

export type AnalyzeResult = {
  flows: Flow[];
  crossLinks: CrossLinks;
};
