import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  COORDINATED_DISCLOSURES,
  DISCLOSURE_METRICS,
  PRE_DISCLOSURE_QUEUE,
  PUBLIC_ADVISORIES,
} from '../lib/community-findings';

const SRC_ROOT = path.resolve(__dirname, '..');

const LEAKED_SYMBOLS: readonly string[] = [
  'CalcUnitsV80',
  'PoolMgrVCUR',
  'handlePreprepareMsg',
  'hasBadProposal',
  'startNewRound',
  'Signer.cpp',
  'mcsp_v1_authenticator',
  'fetch_request',
  'sameHostname',
  'permission-rules.ts',
  'strands-cli',
  'httpPostActionAttachCommentToIssue',
  'httpCreateIssuePostMenuAction',
  'handleSaveSubscription',
  'handleEditChannelSubscription',
  '_permit',
  'ERC721HybridPermitV2',
  'LastClaimedAmounts',
  'updateRewardRecipients',
  'ModSqrt',
  'StarkCurve',
  'BIP32',
  'slash_cancel',
  '4201926',
  '4201632',
  '4201636',
  '4167640',
  '4166411',
  '4167641',
  '4168519',
  '4041302',
  'ticket-369',
  'ticket-370',
  'ticket-371',
];

const AUDITED_FILES: readonly string[] = [
  'lib/community-findings.ts',
  'components/landing/SecurityResearchAdvisories.tsx',
  'components/landing/AdvisoriesLedgerClient.tsx',
];

describe('community advisories and disclosure metrics', () => {
  it('publishes exact counts for verified public advisories and platform submissions', () => {
    expect(PUBLIC_ADVISORIES.length).toBe(6);
    expect(DISCLOSURE_METRICS.publicAdvisoryCount).toBe(6);

    const mayaDisclosures = COORDINATED_DISCLOSURES.filter(
      (item) => item.platform === 'Maya Protocol',
    );
    expect(mayaDisclosures.length).toBe(4);
    expect(DISCLOSURE_METRICS.mayaReportedCount).toBe(2);
    expect(DISCLOSURE_METRICS.mayaQueuedCount).toBe(2);
    expect(DISCLOSURE_METRICS.mayaReportedCount + DISCLOSURE_METRICS.mayaQueuedCount).toBe(4);

    const hackerOneDisclosures = COORDINATED_DISCLOSURES.filter(
      (item) => item.platform === 'HackerOne',
    );
    expect(hackerOneDisclosures.length).toBe(8);
    expect(DISCLOSURE_METRICS.hackerOneCount).toBe(8);

    const bugcrowdDisclosures = COORDINATED_DISCLOSURES.filter(
      (item) => item.platform === 'Bugcrowd',
    );
    expect(bugcrowdDisclosures.length).toBe(8);
    expect(DISCLOSURE_METRICS.bugcrowdCount).toBe(8);

    expect(PRE_DISCLOSURE_QUEUE.length).toBe(5);
    expect(DISCLOSURE_METRICS.preDisclosureDraftCount).toBe(7);
  });

  it('enforces strict Zero-Leak OPSEC gate with no internal symbols or ticket identifiers', () => {
    for (const relativePath of AUDITED_FILES) {
      const fullPath = path.join(SRC_ROOT, relativePath);
      const content = readFileSync(fullPath, 'utf8');

      for (const symbol of LEAKED_SYMBOLS) {
        expect(
          content.includes(symbol),
          `Zero-leak violation: ${relativePath} contains leaked symbol "${symbol}"`,
        ).toBe(false);
      }
    }
  });
});
