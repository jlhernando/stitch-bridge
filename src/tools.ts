import { getClient, fetchContent, fetchBase64 } from './stitch.js';

type DeviceType = 'DEVICE_TYPE_UNSPECIFIED' | 'MOBILE' | 'DESKTOP' | 'TABLET' | 'AGNOSTIC';
type ModelId = 'MODEL_ID_UNSPECIFIED' | 'GEMINI_3_PRO' | 'GEMINI_3_FLASH';

export function toDeviceType(dt?: string): DeviceType {
  if (dt === 'MOBILE' || dt === 'DESKTOP' || dt === 'TABLET' || dt === 'AGNOSTIC') return dt;
  return 'DEVICE_TYPE_UNSPECIFIED';
}

export function toModelId(m?: string): ModelId {
  if (m === 'GEMINI_3_PRO' || m === 'GEMINI_3_FLASH') return m;
  return 'MODEL_ID_UNSPECIFIED';
}

export const TOOLS = [
  {
    name: 'list_projects',
    description: 'List all Stitch projects accessible to the user.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'create_project',
    description: 'Create a new Stitch project (container for UI designs).',
    inputSchema: {
      type: 'object' as const,
      properties: { title: { type: 'string', description: 'Project title (optional)' } },
    },
  },
  {
    name: 'generate_screen',
    description: 'Generate a new UI screen from a text prompt. Returns the screen ID and full HTML content.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'Project ID to generate screen in' },
        prompt: { type: 'string', description: 'Design prompt describing the desired UI' },
        deviceType: { type: 'string', enum: ['MOBILE', 'DESKTOP', 'TABLET', 'AGNOSTIC'], description: 'Target device type (default: DESKTOP)' },
        modelId: { type: 'string', enum: ['GEMINI_3_PRO', 'GEMINI_3_FLASH'], description: 'Model to use for generation (default: GEMINI_3_FLASH)' },
      },
      required: ['projectId', 'prompt'],
    },
  },
  {
    name: 'edit_screen',
    description: 'Edit an existing screen using a text prompt. Returns updated screen ID and HTML.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'Project ID' },
        screenId: { type: 'string', description: 'Screen ID to edit' },
        prompt: { type: 'string', description: 'Edit instructions' },
        deviceType: { type: 'string', enum: ['MOBILE', 'DESKTOP', 'TABLET', 'AGNOSTIC'], description: 'Target device type' },
        modelId: { type: 'string', enum: ['GEMINI_3_PRO', 'GEMINI_3_FLASH'], description: 'Model to use' },
      },
      required: ['projectId', 'screenId', 'prompt'],
    },
  },
  {
    name: 'generate_variants',
    description: 'Generate 1-5 design variants of an existing screen. Returns array of screen IDs and HTML.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'Project ID' },
        screenId: { type: 'string', description: 'Source screen ID to create variants from' },
        prompt: { type: 'string', description: 'Variant generation prompt' },
        count: { type: 'number', description: 'Number of variants (1-5, default: 3)', minimum: 1, maximum: 5 },
        deviceType: { type: 'string', enum: ['MOBILE', 'DESKTOP', 'TABLET', 'AGNOSTIC'], description: 'Target device type' },
        modelId: { type: 'string', enum: ['GEMINI_3_PRO', 'GEMINI_3_FLASH'], description: 'Model to use' },
      },
      required: ['projectId', 'screenId', 'prompt'],
    },
  },
  {
    name: 'list_screens',
    description: 'List all screens in a Stitch project.',
    inputSchema: {
      type: 'object' as const,
      properties: { projectId: { type: 'string', description: 'Project ID' } },
      required: ['projectId'],
    },
  },
  {
    name: 'get_screen_html',
    description: 'Get the full HTML content of a screen. Returns the actual HTML code, not just a URL.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'Project ID' },
        screenId: { type: 'string', description: 'Screen ID' },
      },
      required: ['projectId', 'screenId'],
    },
  },
  {
    name: 'get_screen_image',
    description: 'Get a screenshot of a screen as base64-encoded image.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'Project ID' },
        screenId: { type: 'string', description: 'Screen ID' },
      },
      required: ['projectId', 'screenId'],
    },
  },
  {
    name: 'build_site',
    description: 'Build a multi-page site from a project by mapping screens to URL routes. Returns HTML for each page.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'Project ID' },
        routes: {
          type: 'array', description: 'Array of screen-to-route mappings',
          items: {
            type: 'object',
            properties: {
              screenId: { type: 'string', description: 'Screen ID for this route' },
              route: { type: 'string', description: 'URL route path (e.g. "/" or "/about")' },
            },
            required: ['screenId', 'route'],
          },
        },
      },
      required: ['projectId', 'routes'],
    },
  },
];

export async function handleTool(name: string, args: Record<string, unknown>) {
  const client = getClient();

  switch (name) {
    case 'list_projects': {
      const projects = await client.projects();
      return projects.map(p => ({ id: p.id, title: p.data?.title, deviceType: p.data?.deviceType, theme: p.data?.designTheme }));
    }
    case 'create_project': {
      const project = await client.createProject(args.title as string | undefined);
      return { projectId: project.id, title: project.data?.title };
    }
    case 'generate_screen': {
      const project = client.project(args.projectId as string);
      const screen = await project.generate(args.prompt as string, toDeviceType(args.deviceType as string), toModelId(args.modelId as string));
      const html = await fetchContent(await screen.getHtml());
      return { projectId: screen.projectId, screenId: screen.id, html };
    }
    case 'edit_screen': {
      const project = client.project(args.projectId as string);
      const screen = await project.getScreen(args.screenId as string);
      const edited = await screen.edit(args.prompt as string, toDeviceType(args.deviceType as string), toModelId(args.modelId as string));
      const html = await fetchContent(await edited.getHtml());
      return { projectId: edited.projectId, screenId: edited.id, html };
    }
    case 'generate_variants': {
      const project = client.project(args.projectId as string);
      const screen = await project.getScreen(args.screenId as string);
      const count = (args.count as number) || 3;
      const variants = await screen.variants(args.prompt as string, { variantCount: count }, toDeviceType(args.deviceType as string), toModelId(args.modelId as string));
      const results = await Promise.all(variants.map(async v => {
        const html = await fetchContent(await v.getHtml());
        return { screenId: v.id, html };
      }));
      return { projectId: args.projectId, variants: results };
    }
    case 'list_screens': {
      const project = client.project(args.projectId as string);
      const screens = await project.screens();
      return screens.map(s => ({ screenId: s.id, data: s.data }));
    }
    case 'get_screen_html': {
      const project = client.project(args.projectId as string);
      const screen = await project.getScreen(args.screenId as string);
      const html = await fetchContent(await screen.getHtml());
      return { projectId: args.projectId, screenId: args.screenId, html };
    }
    case 'get_screen_image': {
      const project = client.project(args.projectId as string);
      const screen = await project.getScreen(args.screenId as string);
      const { base64, mimeType } = await fetchBase64(await screen.getImage());
      return { projectId: args.projectId, screenId: args.screenId, base64, mimeType };
    }
    case 'build_site': {
      const project = client.project(args.projectId as string);
      const routes = args.routes as Array<{ screenId: string; route: string }>;
      const pages = await Promise.all(routes.map(async r => {
        const screen = await project.getScreen(r.screenId);
        const html = await fetchContent(await screen.getHtml());
        return { route: r.route, screenId: r.screenId, html };
      }));
      return { projectId: args.projectId, pages };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
