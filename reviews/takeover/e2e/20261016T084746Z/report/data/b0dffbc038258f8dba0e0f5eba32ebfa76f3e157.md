# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: notifications-team.spec.ts >> shows a loading state until the actual isolated notification response arrives
- Location: tests/e2e/notifications-team.spec.ts:61:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('dialog', { name: '通知', exact: true }).getByRole('status')
Expected substring: "正在加载"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" getByRole('dialog', { name: '通知', exact: true }).getByRole('status') with timeout 5000ms
  - waiting for getByRole('dialog', { name: '通知', exact: true }).getByRole('status')

```

```yaml
- dialog "通知":
  - heading "通知" [level=2]
  - button "关闭"
  - heading "暂时没有新消息" [level=3]
  - paragraph: 任务结果与工作空间动态会在这里通知你。
```

# Test source

```ts
  7   |
  8   | async function account(page: Page, studio: Studio) {
  9   |   const owner = await studio.existingIdentitySession();
  10  |   await page
  11  |     .context()
  12  |     .addCookies([
  13  |       {
  14  |         name: 'studio_session',
  15  |         value: owner.sessionToken,
  16  |         url: studio.origin,
  17  |         httpOnly: true,
  18  |         sameSite: 'Lax',
  19  |       },
  20  |     ]);
  21  |   const actor: Actor = {
  22  |     userId: owner.user.id,
  23  |     authType: 'session',
  24  |     apiKeyId: null,
  25  |     workspaceId: null,
  26  |     scopes: [],
  27  |   };
  28  |   return { owner, actor };
  29  | }
  30  |
  31  | async function notifications(page: Page, studio: Studio) {
  32  |   const { owner, actor } = await account(page, studio);
  33  |   const other = studio.services.core.team.create(actor, { name: 'Notification isolation space' });
  34  |   const insert = studio.services.db.sqlite.prepare(
  35  |     'INSERT INTO notifications(id,workspace_id,user_id,title,message,event_key,created_at) VALUES(?,?,?,?,?,?,?)',
  36  |   );
  37  |   for (let index = 1; index <= 25; index++) {
  38  |     insert.run(
  39  |       randomUUID(),
  40  |       owner.workspace.id,
  41  |       owner.user.id,
  42  |       `当前空间通知 ${index}`,
  43  |       `本机真实消息正文 ${index}`,
  44  |       `current-notice:${index}`,
  45  |       new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
  46  |     );
  47  |   }
  48  |   insert.run(
  49  |     randomUUID(),
  50  |     other.id,
  51  |     owner.user.id,
  52  |     '其他空间专有通知',
  53  |     '不得混入当前空间',
  54  |     'other-space-notice',
  55  |     '2026-01-02T00:00:00.000Z',
  56  |   );
  57  |   await page.goto(studio.origin);
  58  |   return { owner, actor, other };
  59  | }
  60  |
  61  | test('shows a loading state until the actual isolated notification response arrives', async ({
  62  |   page,
  63  |   studio,
  64  | }) => {
  65  |   await notifications(page, studio);
  66  |   const matches = (url: URL) =>
  67  |     url.origin === studio.origin && url.pathname === '/api/v1/notifications';
  68  |   let release!: () => void;
  69  |   const barrier = new Promise<void>((resolve) => {
  70  |     release = resolve;
  71  |   });
  72  |   let finish!: () => void;
  73  |   const finished = new Promise<void>((resolve) => {
  74  |     finish = resolve;
  75  |   });
  76  |   let held = false;
  77  |   let ready = false;
  78  |   let failure: string | null = null;
  79  |   const handler = async (route: Route) => {
  80  |     if (held) {
  81  |       await route.fallback();
  82  |       return;
  83  |     }
  84  |     held = true;
  85  |     try {
  86  |       const response = await route.fetch({ maxRetries: 0, maxRedirects: 0 });
  87  |       ready = true;
  88  |       await barrier;
  89  |       await route.fulfill({ response });
  90  |     } catch (error) {
  91  |       failure = error instanceof Error ? error.message : 'Fixture response failed';
  92  |       await route.abort('failed').catch(() => undefined);
  93  |     } finally {
  94  |       finish();
  95  |     }
  96  |   };
  97  |   await page.route(matches, handler);
  98  |   try {
  99  |     await page.getByRole('button', { name: '通知', exact: true }).click();
  100 |     await expect
  101 |       .poll(() => {
  102 |         if (failure) throw new Error(failure);
  103 |         return ready;
  104 |       })
  105 |       .toBe(true);
  106 |     const drawer = page.getByRole('dialog', { name: '通知', exact: true });
> 107 |     await expect(drawer.getByRole('status')).toContainText('正在加载');
      |                                              ^ Error: expect(locator).toContainText(expected) failed
  108 |     await expect(drawer.getByText('暂时没有新消息', { exact: true })).toHaveCount(0);
  109 |     release();
  110 |     await expect(drawer.locator('.notification')).toHaveCount(24);
  111 |     await expect(drawer).toContainText('当前空间通知 25');
  112 |     await expect(drawer).not.toContainText('其他空间专有通知');
  113 |   } finally {
  114 |     release();
  115 |     if (held) await finished;
  116 |     await page.unroute(matches, handler);
  117 |   }
  118 | });
  119 |
  120 | test('shows one injected notification failure and retries against the real API without an empty-state claim', async ({
  121 |   page,
  122 |   studio,
  123 | }) => {
  124 |   await notifications(page, studio);
  125 |   const matches = (url: URL) =>
  126 |     url.origin === studio.origin && url.pathname === '/api/v1/notifications';
  127 |   let failures = 0;
  128 |   let realRequests = 0;
  129 |   await page.route(matches, async (route) => {
  130 |     if (!failures) {
  131 |       failures++;
  132 |       await route.fulfill({
  133 |         status: 503,
  134 |         contentType: 'application/json',
  135 |         body: JSON.stringify({
  136 |           error: { code: 'ISOLATED_NOTIFICATION_FAILURE', message: '隔离通知读取失败' },
  137 |         }),
  138 |       });
  139 |     } else {
  140 |       realRequests++;
  141 |       await route.fallback();
  142 |     }
  143 |   });
  144 |   await page.getByRole('button', { name: '通知', exact: true }).click();
  145 |   const drawer = page.getByRole('dialog', { name: '通知', exact: true });
  146 |   await expect(drawer.getByRole('alert')).toContainText('隔离通知读取失败');
  147 |   await expect(drawer.getByText('暂时没有新消息', { exact: true })).toHaveCount(0);
  148 |   expect(failures).toBe(1);
  149 |   expect(realRequests).toBe(0);
  150 |   await drawer.getByRole('button', { name: '重试', exact: true }).click();
  151 |   await expect(drawer.locator('.notification')).toHaveCount(24);
  152 |   await expect(drawer).toContainText('当前空间通知 25');
  153 |   await expect(drawer).not.toContainText('其他空间专有通知');
  154 |   expect(failures).toBe(1);
  155 |   expect(realRequests).toBe(1);
  156 | });
  157 |
  158 | test('reaches notification 25 through real pagination and preserves read and workspace boundaries', async ({
  159 |   page,
  160 |   studio,
  161 | }) => {
  162 |   const { owner, other } = await notifications(page, studio);
  163 |   await page.getByRole('button', { name: '通知', exact: true }).click();
  164 |   const drawer = page.getByRole('dialog', { name: '通知', exact: true });
  165 |   await expect(drawer.locator('.notification')).toHaveCount(24);
  166 |   await expect(drawer).not.toContainText('其他空间专有通知');
  167 |   await expect(drawer.getByText('当前空间通知 1', { exact: true })).toHaveCount(0);
  168 |   await drawer.getByRole('button', { name: '下一页', exact: true }).click();
  169 |   await expect(drawer.locator('.notification')).toHaveCount(1);
  170 |   await expect(drawer.getByText('当前空间通知 1', { exact: true })).toBeVisible();
  171 |   await expect(drawer).toContainText('本机真实消息正文 1');
  172 |   await expect(drawer).not.toContainText('其他空间专有通知');
  173 |   await drawer.getByRole('button', { name: '标为已读', exact: true }).click();
  174 |   await expect(drawer.getByRole('button', { name: '标为已读', exact: true })).toHaveCount(0);
  175 |   const read = studio.services.db.sqlite
  176 |     .prepare('SELECT read_at FROM notifications WHERE workspace_id=? AND event_key=?')
  177 |     .get(owner.workspace.id, 'current-notice:1') as { read_at: string | null };
  178 |   expect(read.read_at).not.toBeNull();
  179 |   await drawer.getByRole('button', { name: '上一页', exact: true }).click();
  180 |   await expect(drawer.locator('.notification')).toHaveCount(24);
  181 |   await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  182 |   const switched = await page.request.post(
  183 |     `${studio.origin}/api/v1/workspaces/${other.id}/activate`,
  184 |     { headers: { origin: studio.origin } },
  185 |   );
  186 |   expect(switched.status()).toBe(200);
  187 |   await page.reload();
  188 |   await page.getByRole('button', { name: '通知', exact: true }).click();
  189 |   await expect(drawer.locator('.notification')).toHaveCount(1);
  190 |   await expect(drawer).toContainText('其他空间专有通知');
  191 |   await expect(drawer).not.toContainText('当前空间通知');
  192 |   await expect(drawer.getByRole('button', { name: '下一页', exact: true })).toHaveCount(0);
  193 |   const foreign = studio.services.db.sqlite
  194 |     .prepare('SELECT read_at FROM notifications WHERE workspace_id=?')
  195 |     .get(other.id) as { read_at: string | null };
  196 |   expect(foreign.read_at).toBeNull();
  197 | });
  198 |
  199 | for (const language of [
  200 |   { id: 'en', owner: 'Owner' },
  201 |   { id: 'ar', owner: 'المالك' },
  202 | ] as const) {
  203 |   test(`translates ${language.id} team role labels while retaining the actual owner role`, async ({
  204 |     page,
  205 |     studio,
  206 |   }) => {
  207 |     const { owner, actor } = await account(page, studio);
```
