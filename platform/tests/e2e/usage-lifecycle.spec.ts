import { createHash, randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import type { Actor } from '../../src/contracts/core';
import { createBillingAdmin } from '../../src/server/billing/admin';
import { test, expect, type Studio } from './fixtures';

test.use({ recoveryEnabled: false, smsEnabled: false });

async function account(page: Page, studio: Studio) {
  const owner = await studio.existingIdentitySession();
  const actor: Actor = {
    userId: owner.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  await page.context().addCookies([
    {
      name: 'studio_session',
      value: owner.sessionToken,
      url: studio.origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  return { actor, wid: owner.workspace.id };
}

function plan(studio: Studio, actor: Actor) {
  const id = randomUUID();
  createBillingAdmin(studio.services.db).importPlans({
    actorUserId: actor.userId,
    reason: 'Isolated browser lifecycle fixture; no payment or external invoice service.',
    version: 1,
    confirmCommercialCatalog: true,
    plans: [
      {
        id,
        name: '隔离测试额度包',
        kind: 'credits',
        priceMinor: 2000,
        currency: 'USD',
        credits: 200,
        interval: null,
        limits: {},
        active: true,
      },
    ],
  });
  return id;
}

async function holdResponse(page: Page, url: string) {
  let release!: () => void;
  let saved!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    saved = resolve;
  });
  await page.route(
    url,
    async (route) => {
      const response = await route.fetch();
      saved();
      await held;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  return { release, reached };
}

for (const creating of [true, false]) {
  test(`keeps invoice title edits during delayed ${creating ? 'creation' : 'update'} and continues on the saved record`, async ({
    page,
    studio,
  }) => {
    const { actor, wid } = await account(page, studio);
    const core = studio.services.core;
    const title = creating
      ? null
      : core.business.createTitle(actor, wid, {
          type: 'personal',
          name: '原始抬头',
          taxId: null,
          email: null,
        });
    await page.goto(`${studio.origin}/usage?tab=invoices`);
    await page
      .getByRole('button', { name: creating ? '新增抬头' : '编辑抬头', exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('抬头类型').selectOption('personal');
    await dialog.getByLabel('抬头名称').fill('提交的抬头A');
    const held = await holdResponse(
      page,
      creating ? '**/api/v1/invoice-titles' : `**/api/v1/invoice-titles/${title!.id}`,
    );
    await dialog.getByRole('button', { name: '保存抬头', exact: true }).click();
    await held.reached;
    await dialog.getByLabel('抬头名称').fill('继续输入的抬头B');
    held.release();
    await expect(dialog.getByRole('button', { name: '保存抬头', exact: true })).toBeEnabled();
    await expect(dialog.getByLabel('抬头名称')).toHaveValue('继续输入的抬头B');
    const first = core.business.titles(actor, wid, {}).items;
    expect(first).toHaveLength(1);
    expect(first[0]!.name).toBe('提交的抬头A');
    await dialog.getByRole('button', { name: '保存抬头', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const final = core.business.titles(actor, wid, {}).items;
    expect(final).toHaveLength(1);
    expect(final[0]).toMatchObject({ id: first[0]!.id, name: '继续输入的抬头B' });
  });
}

test('does not close a new invoice title editor when an older editor finishes saving', async ({
  page,
  studio,
}) => {
  const { actor, wid } = await account(page, studio);
  await page.goto(`${studio.origin}/usage?tab=invoices`);
  await page.getByRole('button', { name: '新增抬头', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('抬头类型').selectOption('personal');
  await dialog.getByLabel('抬头名称').fill('旧弹窗提交');
  const held = await holdResponse(page, '**/api/v1/invoice-titles');
  await dialog.getByRole('button', { name: '保存抬头', exact: true }).click();
  await held.reached;
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '新增抬头', exact: true }).click();
  await dialog.getByLabel('抬头类型').selectOption('personal');
  await dialog.getByLabel('抬头名称').fill('新弹窗草稿');
  held.release();
  await expect(dialog.getByRole('button', { name: '保存抬头', exact: true })).toBeEnabled();
  await expect(dialog.getByLabel('抬头名称')).toHaveValue('新弹窗草稿');
  await dialog.getByRole('button', { name: '保存抬头', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    studio.services.core.business
      .titles(actor, wid, {})
      .items.map((t) => t.name)
      .sort(),
  ).toEqual(['新弹窗草稿', '旧弹窗提交'].sort());
});

test('redeems each code once, preserves the next code during a delayed response, and keeps API credits separate', async ({
  page,
  studio,
}) => {
  const { actor, wid } = await account(page, studio);
  const sql = studio.services.db.sqlite;
  const codes = ['LOCAL-FIRST-CODE', 'LOCAL-SECOND-CODE'];
  for (const code of codes)
    sql
      .prepare('INSERT INTO redemption_codes(id,code_hash,credits,created_at) VALUES(?,?,?,?)')
      .run(
        randomUUID(),
        createHash('sha256').update(code).digest('hex'),
        17,
        new Date().toISOString(),
      );
  const before = studio.services.balance(actor, wid);
  const apiBefore = sql
    .prepare(
      "SELECT balance,reserved FROM credit_accounts WHERE workspace_id=? AND billing_channel='api'",
    )
    .get(wid);
  await page.goto(`${studio.origin}/usage`);
  await page.getByRole('button', { name: '兑换额度', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '兑换额度', exact: true });
  await dialog.getByLabel('兑换码').fill(codes[0]!);
  const held = await holdResponse(page, '**/api/v1/credits/redeem');
  await dialog.getByRole('button', { name: '确认兑换', exact: true }).click();
  await held.reached;
  await dialog.getByLabel('兑换码').fill(codes[1]!);
  held.release();
  await expect(dialog.getByRole('button', { name: '确认兑换', exact: true })).toBeEnabled();
  await expect(dialog.getByLabel('兑换码')).toHaveValue(codes[1]!);
  expect(studio.services.balance(actor, wid).balance).toBe(before.balance + 17);
  await dialog.getByRole('button', { name: '确认兑换', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  expect(studio.services.balance(actor, wid).balance).toBe(before.balance + 34);
  await page.getByRole('button', { name: '兑换额度', exact: true }).click();
  await dialog.getByLabel('兑换码').fill(codes[0]!);
  await dialog.getByRole('button', { name: '确认兑换', exact: true }).click();
  await expect(page.getByText('兑换码无效、已使用或已过期', { exact: true })).toBeVisible();
  expect(studio.services.balance(actor, wid).balance).toBe(before.balance + 34);
  expect(
    sql.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE event_key LIKE 'redeem:%'").get(),
  ).toEqual({ n: 2 });
  expect(
    sql
      .prepare(
        "SELECT balance,reserved FROM credit_accounts WHERE workspace_id=? AND billing_channel='api'",
      )
      .get(wid),
  ).toEqual(apiBefore);
});

test('creates and cancels an unpaid order without granting credits or starting checkout', async ({
  page,
  studio,
}) => {
  const { actor, wid } = await account(page, studio);
  plan(studio, actor);
  const before = studio.services.balance(actor, wid);
  await page.goto(`${studio.origin}/usage?tab=plans`);
  await page.getByRole('button', { name: '查看并保存订单草稿', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '确认方案', exact: true });
  await expect(dialog).toContainText('支付服务尚未连接');
  await dialog.getByRole('button', { name: '创建订单', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const orders = studio.services.core.business.orders(actor, wid, {}).items;
  expect(orders).toHaveLength(1);
  expect(orders[0]!.status).toBe('draft');
  await page
    .locator('tbody tr')
    .filter({ hasText: orders[0]!.number })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: '关闭这笔订单？' })
    .getByRole('button', { name: '确认', exact: true })
    .click();
  await expect(page.locator('tbody tr').filter({ hasText: orders[0]!.number })).toContainText(
    '已关闭',
  );
  await page.reload();
  expect(studio.services.core.business.getOrder(actor, wid, orders[0]!.id).status).toBe(
    'cancelled',
  );
  expect(studio.services.balance(actor, wid)).toEqual(before);
  expect(
    studio.services.db.sqlite.prepare('SELECT COUNT(*) n FROM stripe_checkouts').get(),
  ).toEqual({ n: 0 });
});

test('saves, registers, withdraws and reapplies a local invoice with preserved title snapshots and released amounts', async ({
  page,
  studio,
}) => {
  const { actor, wid } = await account(page, studio);
  const core = studio.services.core;
  const order = core.business.createOrder(actor, wid, { planId: plan(studio, actor) });
  // Explicit synthetic historical payment: this verifies local invoice management, not payment settlement.
  studio.services.db.sqlite
    .prepare(
      "UPDATE orders SET status='paid',payment_environment='test',refunded_minor=500 WHERE id=?",
    )
    .run(order.id);
  await page.goto(`${studio.origin}/usage?tab=invoices`);
  await page.getByRole('button', { name: '新增抬头', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('抬头类型').selectOption('personal');
  await dialog.getByLabel('抬头名称').fill('本地申请原抬头');
  await dialog.getByRole('button', { name: '保存抬头', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const title = core.business.titles(actor, wid, {}).items[0]!;
  async function apply() {
    await page.getByRole('button', { name: '申请发票', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '申请发票', exact: true });
    await dialog.getByRole('combobox', { name: '发票抬头', exact: true }).selectOption(title.id);
    await dialog.getByRole('checkbox', { name: new RegExp(order.number) }).check();
    await dialog.getByRole('button', { name: '保存发票申请', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  await apply();
  const first = core.business.invoices(actor, wid, {}).items[0]!;
  expect(first).toMatchObject({
    status: 'draft',
    amountMinor: 1500,
    titleSnapshot: { name: '本地申请原抬头' },
  });
  expect(core.business.getOrder(actor, wid, order.id).invoiceableMinor).toBe(0);
  await page.getByRole('button', { name: '编辑抬头', exact: true }).click();
  await page.getByLabel('抬头名称').fill('以后申请的新抬头');
  await page.getByRole('button', { name: '保存抬头', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(core.business.invoice(actor, wid, first.id).titleSnapshot).toMatchObject({
    name: '本地申请原抬头',
  });
  await page.getByRole('button', { name: '登记开票申请', exact: true }).click();
  await expect(page.locator('tbody')).toContainText('已登记申请，未发送');
  expect(core.business.invoice(actor, wid, first.id)).toMatchObject({
    status: 'pending',
    delivery: 'not-sent',
    downloadAvailable: false,
    fileUrl: null,
  });
  await page.reload();
  await page.getByRole('button', { name: '查看申请', exact: true }).click();
  await page.getByRole('button', { name: '撤回申请', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '撤回开票申请', exact: true });
  await dialog.getByLabel('撤回原因').fill('修正申请抬头');
  await dialog.getByRole('button', { name: '确认撤回', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const withdrawn = core.business.invoice(actor, wid, first.id);
  expect(withdrawn.status).toBe('withdrawn');
  expect(withdrawn.events.map((event) => event.kind).sort()).toEqual([
    'local-requested',
    'withdrawn',
  ]);
  expect(core.business.getOrder(actor, wid, order.id).invoiceableMinor).toBe(1500);
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await apply();
  const requests = core.business.invoices(actor, wid, {}).items;
  expect(requests).toHaveLength(2);
  expect(requests.find((request) => request.id !== first.id)).toMatchObject({
    status: 'draft',
    amountMinor: 1500,
    titleSnapshot: { name: '以后申请的新抬头' },
  });
  expect(
    studio.services.db.sqlite.prepare('SELECT COUNT(*) n FROM stripe_checkouts').get(),
  ).toEqual({ n: 0 });
});

test('selects invoice orders across pages without losing selections or reporting allocated amounts as available', async ({
  page,
  studio,
}) => {
  const { actor, wid } = await account(page, studio);
  const core = studio.services.core;
  const planId = plan(studio, actor);
  const title = core.business.createTitle(actor, wid, {
    type: 'personal',
    name: '分页申请抬头',
    taxId: null,
    email: null,
  });
  const orders = Array.from({ length: 101 }, (_, index) => {
    const order = core.business.createOrder(actor, wid, { planId });
    // Keep the first and last orders eligible, with exactly 100 orders on page one.
    studio.services.db.sqlite
      .prepare('UPDATE orders SET created_at=?,status=?,payment_environment=? WHERE id=?')
      .run(
        new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
        index === 0 || index === 100 ? 'paid' : 'draft',
        'test',
        order.id,
      );
    return order;
  });
  await page.goto(`${studio.origin}/usage?tab=invoices`);
  await page.getByRole('button', { name: '申请发票', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '申请发票', exact: true });
  await dialog.getByRole('combobox', { name: '发票抬头', exact: true }).selectOption(title.id);
  await expect(dialog.getByRole('checkbox')).toHaveCount(1);
  await dialog.getByRole('checkbox', { name: new RegExp(orders[100]!.number) }).check();
  await dialog.getByRole('button', { name: '下一页', exact: true }).click();
  await dialog.getByRole('checkbox', { name: new RegExp(orders[0]!.number) }).check();
  await dialog.getByRole('button', { name: '上一页', exact: true }).click();
  await expect(
    dialog.getByRole('checkbox', { name: new RegExp(orders[100]!.number) }),
  ).toBeChecked();
  await dialog.getByRole('button', { name: '保存发票申请', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const request = core.business.invoices(actor, wid, {}).items[0]!;
  expect(request.amountMinor).toBe(4000);
  expect(request.orderIds.sort()).toEqual([orders[0]!.id, orders[100]!.id].sort());
  await page.getByRole('button', { name: '申请发票', exact: true }).click();
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await expect(dialog).toContainText('当前页没有可申请金额的已支付订单');
  await expect(dialog.getByRole('button', { name: '保存发票申请', exact: true })).toBeDisabled();
  await page.screenshot({ path: `${studio.folder}/invoice-pagination.png`, fullPage: true });
});

test('preserves another invoice selection after an earlier request finishes saving', async ({
  page,
  studio,
}) => {
  const { actor, wid } = await account(page, studio);
  const core = studio.services.core;
  const planId = plan(studio, actor);
  const title = core.business.createTitle(actor, wid, {
    type: 'personal',
    name: '申请会话抬头',
    taxId: null,
    email: null,
  });
  const orders = [0, 1].map(() => {
    const order = core.business.createOrder(actor, wid, { planId });
    studio.services.db.sqlite
      .prepare("UPDATE orders SET status='paid',payment_environment='test' WHERE id=?")
      .run(order.id);
    return order;
  });
  await page.goto(`${studio.origin}/usage?tab=invoices`);
  await page.getByRole('button', { name: '申请发票', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '申请发票', exact: true });
  await dialog.getByRole('combobox', { name: '发票抬头', exact: true }).selectOption(title.id);
  await dialog.getByRole('checkbox', { name: new RegExp(orders[0]!.number) }).check();
  const held = await holdResponse(page, '**/api/v1/invoices');
  await dialog.getByRole('button', { name: '保存发票申请', exact: true }).click();
  await held.reached;
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '申请发票', exact: true }).click();
  await expect(dialog.getByRole('checkbox', { name: new RegExp(orders[0]!.number) })).toHaveCount(
    0,
  );
  await dialog.getByRole('checkbox', { name: new RegExp(orders[1]!.number) }).check();
  held.release();
  await expect(dialog.getByRole('button', { name: '保存发票申请', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('checkbox', { name: new RegExp(orders[1]!.number) })).toBeChecked();
  await dialog.getByRole('button', { name: '保存发票申请', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const invoices = core.business.invoices(actor, wid, {}).items;
  expect(invoices).toHaveLength(2);
  expect(
    invoices
      .map((invoice) => invoice.orderIds)
      .flat()
      .sort(),
  ).toEqual(orders.map((order) => order.id).sort());
});

test('keeps a second invoice withdrawal and its reason when the first withdrawal response is delayed', async ({
  page,
  studio,
}) => {
  const { actor, wid } = await account(page, studio);
  const core = studio.services.core;
  const planId = plan(studio, actor);
  const title = core.business.createTitle(actor, wid, {
    type: 'personal',
    name: '撤回会话抬头',
    taxId: null,
    email: null,
  });
  const invoices = [1000, 2000].map((amount) => {
    const order = core.business.createOrder(actor, wid, { planId });
    studio.services.db.sqlite
      .prepare(
        "UPDATE orders SET status='paid',amount_minor=?,payment_environment='test' WHERE id=?",
      )
      .run(amount, order.id);
    return core.business.createInvoice(actor, wid, { titleId: title.id, orderIds: [order.id] });
  });
  await page.goto(`${studio.origin}/usage?tab=invoices`);
  async function withdraw(amount: string) {
    await page
      .locator('tbody tr')
      .filter({ hasText: amount })
      .getByRole('button', { name: '查看申请', exact: true })
      .click();
    await page.getByRole('button', { name: '撤回申请', exact: true }).click();
  }
  await withdraw('US$10.00');
  const dialog = page.getByRole('dialog', { name: '撤回开票申请', exact: true });
  await dialog.getByRole('textbox', { name: '撤回原因', exact: true }).fill('第一笔撤回原因');
  const held = await holdResponse(page, `**/api/v1/invoices/${invoices[0]!.id}/withdraw`);
  await dialog.getByRole('button', { name: '确认撤回', exact: true }).click();
  await held.reached;
  await expect(dialog.getByRole('textbox', { name: '撤回原因', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await withdraw('US$20.00');
  await expect(dialog.getByRole('textbox', { name: '撤回原因', exact: true })).toHaveValue('');
  await dialog.getByRole('textbox', { name: '撤回原因', exact: true }).fill('第二笔未提交原因');
  held.release();
  await expect(dialog.getByRole('button', { name: '确认撤回', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('textbox', { name: '撤回原因', exact: true })).toHaveValue(
    '第二笔未提交原因',
  );
  expect(core.business.invoice(actor, wid, invoices[0]!.id).status).toBe('withdrawn');
  expect(core.business.invoice(actor, wid, invoices[1]!.id).status).toBe('draft');
  await dialog.getByRole('button', { name: '确认撤回', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(core.business.invoice(actor, wid, invoices[1]!.id).events.at(-1)?.details).toMatchObject({
    reason: '第二笔未提交原因',
  });
});
