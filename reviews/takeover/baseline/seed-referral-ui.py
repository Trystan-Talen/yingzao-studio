"""Isolated UI fixtures only: no orders, payments, balances or rewards are created."""
import json
import sqlite3
import sys
import uuid
from pathlib import Path

root = Path(__file__).resolve().parents[3]
db = root / 'platform/var/takeover/baseline-app/demo.sqlite'
backup = root / 'platform/var/takeover/baseline-app/referral-ui-program-before.json'
con = sqlite3.connect(db)
con.row_factory = sqlite3.Row
current = dict(con.execute("SELECT * FROM referral_program WHERE id='default'").fetchone())
if sys.argv[1:] == ['restore']:
    original = json.loads(backup.read_text())
    cols = [col for col in original if col != 'id']
    with con:
        con.execute(f"UPDATE referral_program SET {','.join(f'{col}=?' for col in cols)} WHERE id='default'", [original[col] for col in cols])
    print('Original program configuration restored; UI-only attribution fixtures retained.')
    sys.exit(0)
if not backup.exists():
    backup.write_text(json.dumps(current, ensure_ascii=False, indent=2))
ref = con.execute("SELECT r.id FROM referrals r JOIN users u ON u.id=r.user_id WHERE u.display_name='演示创作者'").fetchone()[0]
policy = {'kind': 'personal-first-subscription-v1', 'referrerBps': 1500,
          'inviteeBps': 1000, 'registrationWindowDays': 30, 'rewardValidityDays': 7,
          'rounding': 'unconfigured', 'membershipRequirement': 'unconfigured', 'evidenceReference': ''}
configured = {**policy, 'rounding': 'floor', 'membershipRequirement': 'none',
              'evidenceReference': '测试夹具：显示规则快照，无付款、无奖励、非原站资格解释'}
with con:
    con.execute("UPDATE referral_program SET policy_json=?,version=9003 WHERE id='default'", [json.dumps(policy)])
    for version, policy_value in [(9001, None), (9002, configured), (9003, policy)]:
        uid = str(uuid.uuid5(uuid.NAMESPACE_URL, f'yingzao-takeover-referral-ui-user-{version}'))
        aid = str(uuid.uuid5(uuid.NAMESPACE_URL, f'yingzao-takeover-referral-ui-attribution-{version}'))
        at = f'2026-10-16T08:20:0{version-9001}.000Z'
        con.execute('INSERT OR IGNORE INTO users(id,email,password_hash,display_name,local_password_enabled,created_at,updated_at) VALUES(?,?,?,?,0,?,?)',
                    [uid,f'referral-ui-{version}@example.invalid','disabled-fixture',f'测试夹具：邀请规则显示 {version}',at,at])
        snapshot = {**current, 'rewards_enabled': 1, 'reward_credits': 50, 'version': version,
                    'policy_json': json.dumps(policy_value) if policy_value else None}
        con.execute('INSERT INTO referral_attributions(id,user_id,referral_id,program_snapshot_json,created_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET program_snapshot_json=excluded.program_snapshot_json',
                    [aid,uid,ref,json.dumps(snapshot),at])
print('UI fixture program version 9003; snapshots 9001 legacy, 9002 configured, 9003 incomplete. No payments or rewards.')
