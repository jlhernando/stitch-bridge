import { describe, it, expect, vi } from 'vitest';

function mockScreen(id: string, projectId = 'proj-1') {
  return {
    id, screenId: id, projectId, data: { name: `screen-${id}` },
    getHtml: vi.fn().mockResolvedValue(`https://stitch.test/html/${id}`),
    getImage: vi.fn().mockResolvedValue(`https://stitch.test/image/${id}`),
    edit: vi.fn().mockImplementation(async () => mockScreen(`${id}-edited`, projectId)),
    variants: vi.fn().mockImplementation(async (_p: string, opts: { variantCount: number }) =>
      Array.from({ length: opts.variantCount }, (_, i) => mockScreen(`${id}-var${i}`, projectId))
    ),
  };
}

function mockProject(id: string) {
  return {
    id, projectId: id, data: { title: `Project ${id}`, deviceType: 'DESKTOP', designTheme: { font: 'Inter' } },
    generate: vi.fn().mockImplementation(async () => mockScreen('scr-new', id)),
    screens: vi.fn().mockResolvedValue([mockScreen('scr-1', id), mockScreen('scr-2', id)]),
    getScreen: vi.fn().mockImplementation(async (screenId: string) => mockScreen(screenId, id)),
  };
}

function makeMocks() {
  const client = {
    projects: vi.fn().mockResolvedValue([mockProject('proj-1'), mockProject('proj-2')]),
    createProject: vi.fn().mockImplementation(async (title?: string) => {
      const p = mockProject('proj-new');
      p.data.title = title || 'Untitled';
      return p;
    }),
    project: vi.fn().mockImplementation((id: string) => mockProject(id)),
  };
  return client;
}

async function loadTools(client: ReturnType<typeof makeMocks>) {
  vi.resetModules();
  process.env.STITCH_API_KEY = 'test-key';
  vi.doMock('../src/stitch.js', () => ({
    getClient: () => client,
    fetchContent: async (url: string) => `<html><body>${url.split('/').pop()}</body></html>`,
    fetchBase64: async (url: string) => ({ base64: Buffer.from(url).toString('base64'), mimeType: 'image/png' }),
  }));
  const { handleTool, TOOLS, toDeviceType, toModelId } = await import('../src/tools.js');
  return { handleTool, TOOLS, toDeviceType, toModelId };
}

describe('stitch-bridge', () => {
  describe('auth', () => {
    it('throws without env vars', async () => {
      vi.resetModules();
      const origKey = process.env.STITCH_API_KEY;
      const origToken = process.env.STITCH_ACCESS_TOKEN;
      delete process.env.STITCH_API_KEY;
      delete process.env.STITCH_ACCESS_TOKEN;
      vi.doMock('@google/stitch-sdk', () => ({ stitch: {} }));
      const { getClient } = await import('../src/stitch.js');
      expect(() => getClient()).toThrow('STITCH_API_KEY or STITCH_ACCESS_TOKEN');
      process.env.STITCH_API_KEY = origKey;
      if (origToken) process.env.STITCH_ACCESS_TOKEN = origToken;
    });

    it('works with STITCH_API_KEY', async () => {
      vi.resetModules();
      process.env.STITCH_API_KEY = 'key';
      const mock = {};
      vi.doMock('@google/stitch-sdk', () => ({ stitch: mock }));
      const { getClient } = await import('../src/stitch.js');
      expect(getClient()).toBe(mock);
    });

    it('works with STITCH_ACCESS_TOKEN', async () => {
      vi.resetModules();
      delete process.env.STITCH_API_KEY;
      process.env.STITCH_ACCESS_TOKEN = 'tok';
      const mock = {};
      vi.doMock('@google/stitch-sdk', () => ({ stitch: mock }));
      const { getClient } = await import('../src/stitch.js');
      expect(getClient()).toBe(mock);
      process.env.STITCH_API_KEY = 'restore';
    });
  });

  describe('fetchContent', () => {
    it('returns text from URL', async () => {
      vi.resetModules();
      process.env.STITCH_API_KEY = 'key';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '<html>ok</html>' }));
      vi.doMock('@google/stitch-sdk', () => ({ stitch: {} }));
      const { fetchContent } = await import('../src/stitch.js');
      expect(await fetchContent('https://test.com')).toBe('<html>ok</html>');
    });

    it('throws on non-ok response', async () => {
      vi.resetModules();
      process.env.STITCH_API_KEY = 'key';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
      vi.doMock('@google/stitch-sdk', () => ({ stitch: {} }));
      const { fetchContent } = await import('../src/stitch.js');
      await expect(fetchContent('https://fail.test')).rejects.toThrow('Failed to fetch');
    });
  });

  describe('fetchBase64', () => {
    it('returns base64 and mimeType', async () => {
      vi.resetModules();
      process.env.STITCH_API_KEY = 'key';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        headers: { get: () => 'image/webp' },
      }));
      vi.doMock('@google/stitch-sdk', () => ({ stitch: {} }));
      const { fetchBase64 } = await import('../src/stitch.js');
      const r = await fetchBase64('https://test.com/img');
      expect(r.base64).toBeTruthy();
      expect(r.mimeType).toBe('image/webp');
    });
  });

  describe('tool definitions', () => {
    it('has 9 tools', async () => {
      const { TOOLS } = await loadTools(makeMocks());
      expect(TOOLS).toHaveLength(9);
    });

    it('all tools have name, description, inputSchema', async () => {
      const { TOOLS } = await loadTools(makeMocks());
      for (const t of TOOLS) {
        expect(t.name).toBeTruthy();
        expect(t.description).toBeTruthy();
        expect(t.inputSchema.type).toBe('object');
      }
    });

    it('generate_screen requires projectId and prompt', async () => {
      const { TOOLS } = await loadTools(makeMocks());
      const t = TOOLS.find(t => t.name === 'generate_screen')!;
      expect(t.inputSchema.required).toContain('projectId');
      expect(t.inputSchema.required).toContain('prompt');
    });
  });

  describe('helpers', () => {
    it('toDeviceType maps valid values', async () => {
      const { toDeviceType } = await loadTools(makeMocks());
      expect(toDeviceType('MOBILE')).toBe('MOBILE');
      expect(toDeviceType('DESKTOP')).toBe('DESKTOP');
      expect(toDeviceType('TABLET')).toBe('TABLET');
      expect(toDeviceType('AGNOSTIC')).toBe('AGNOSTIC');
      expect(toDeviceType()).toBe('DEVICE_TYPE_UNSPECIFIED');
      expect(toDeviceType('bad')).toBe('DEVICE_TYPE_UNSPECIFIED');
    });

    it('toModelId maps valid values', async () => {
      const { toModelId } = await loadTools(makeMocks());
      expect(toModelId('GEMINI_3_PRO')).toBe('GEMINI_3_PRO');
      expect(toModelId('GEMINI_3_FLASH')).toBe('GEMINI_3_FLASH');
      expect(toModelId()).toBe('MODEL_ID_UNSPECIFIED');
      expect(toModelId('bad')).toBe('MODEL_ID_UNSPECIFIED');
    });
  });

  describe('list_projects', () => {
    it('returns projects with id and title', async () => {
      const client = makeMocks();
      const { handleTool } = await loadTools(client);
      const result = await handleTool('list_projects', {}) as Array<{ id: string; title: string }>;
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('proj-1');
      expect(result[1].id).toBe('proj-2');
    });
  });

  describe('create_project', () => {
    it('creates with title', async () => {
      const client = makeMocks();
      const { handleTool } = await loadTools(client);
      const result = await handleTool('create_project', { title: 'My App' }) as { projectId: string; title: string };
      expect(result.projectId).toBe('proj-new');
      expect(result.title).toBe('My App');
    });

    it('creates without title', async () => {
      const client = makeMocks();
      const { handleTool } = await loadTools(client);
      const result = await handleTool('create_project', {}) as { projectId: string; title: string };
      expect(result.projectId).toBe('proj-new');
      expect(result.title).toBe('Untitled');
    });
  });

  describe('generate_screen', () => {
    it('returns screenId and HTML', async () => {
      const client = makeMocks();
      const { handleTool } = await loadTools(client);
      const result = await handleTool('generate_screen', { projectId: 'proj-1', prompt: 'Login page' }) as { screenId: string; html: string };
      expect(result.screenId).toBe('scr-new');
      expect(result.html).toContain('<html>');
    });

    it('passes deviceType and modelId', async () => {
      const client = makeMocks();
      const { handleTool } = await loadTools(client);
      await handleTool('generate_screen', { projectId: 'proj-1', prompt: 'Dashboard', deviceType: 'MOBILE', modelId: 'GEMINI_3_PRO' });
      const project = client.project.mock.results[0].value;
      expect(project.generate).toHaveBeenCalledWith('Dashboard', 'MOBILE', 'GEMINI_3_PRO');
    });
  });

  describe('edit_screen', () => {
    it('returns edited screenId and HTML', async () => {
      const client = makeMocks();
      const { handleTool } = await loadTools(client);
      const result = await handleTool('edit_screen', { projectId: 'proj-1', screenId: 'scr-1', prompt: 'Make blue' }) as { screenId: string; html: string };
      expect(result.screenId).toBe('scr-1-edited');
      expect(result.html).toContain('<html>');
    });
  });

  describe('generate_variants', () => {
    it('returns requested count of variants', async () => {
      const client = makeMocks();
      const { handleTool } = await loadTools(client);
      const result = await handleTool('generate_variants', { projectId: 'proj-1', screenId: 'scr-1', prompt: 'Darker', count: 2 }) as { variants: Array<{ screenId: string; html: string }> };
      expect(result.variants).toHaveLength(2);
      expect(result.variants[0].screenId).toBe('scr-1-var0');
      expect(result.variants[1].html).toContain('<html>');
    });

    it('defaults to 3 variants', async () => {
      const client = makeMocks();
      const { handleTool } = await loadTools(client);
      const result = await handleTool('generate_variants', { projectId: 'proj-1', screenId: 'scr-1', prompt: 'Playful' }) as { variants: unknown[] };
      expect(result.variants).toHaveLength(3);
    });
  });

  describe('list_screens', () => {
    it('returns screens in project', async () => {
      const client = makeMocks();
      const { handleTool } = await loadTools(client);
      const result = await handleTool('list_screens', { projectId: 'proj-1' }) as Array<{ screenId: string }>;
      expect(result).toHaveLength(2);
      expect(result[0].screenId).toBe('scr-1');
    });
  });

  describe('get_screen_html', () => {
    it('returns actual HTML content', async () => {
      const client = makeMocks();
      const { handleTool } = await loadTools(client);
      const result = await handleTool('get_screen_html', { projectId: 'proj-1', screenId: 'scr-1' }) as { html: string };
      expect(result.html).toContain('<html>');
      expect(result.html).toContain('scr-1');
    });
  });

  describe('get_screen_image', () => {
    it('returns base64 image', async () => {
      const client = makeMocks();
      const { handleTool } = await loadTools(client);
      const result = await handleTool('get_screen_image', { projectId: 'proj-1', screenId: 'scr-1' }) as { base64: string; mimeType: string };
      expect(result.base64).toBeTruthy();
      expect(result.mimeType).toBe('image/png');
    });
  });

  describe('build_site', () => {
    it('maps screens to routes with HTML', async () => {
      const client = makeMocks();
      const { handleTool } = await loadTools(client);
      const result = await handleTool('build_site', {
        projectId: 'proj-1',
        routes: [{ screenId: 'scr-1', route: '/' }, { screenId: 'scr-2', route: '/about' }],
      }) as { pages: Array<{ route: string; html: string }> };
      expect(result.pages).toHaveLength(2);
      expect(result.pages[0].route).toBe('/');
      expect(result.pages[0].html).toContain('scr-1');
      expect(result.pages[1].route).toBe('/about');
    });
  });

  describe('error handling', () => {
    it('throws on unknown tool', async () => {
      const { handleTool } = await loadTools(makeMocks());
      await expect(handleTool('nonexistent', {})).rejects.toThrow('Unknown tool: nonexistent');
    });

    it('propagates SDK errors', async () => {
      const client = makeMocks();
      client.projects.mockRejectedValue(new Error('API quota exceeded'));
      const { handleTool } = await loadTools(client);
      await expect(handleTool('list_projects', {})).rejects.toThrow('API quota exceeded');
    });
  });
});
