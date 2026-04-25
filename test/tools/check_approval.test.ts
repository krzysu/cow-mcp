import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readContractMock = vi.fn();

vi.mock('../../src/cow/rpc.js', () => ({
  getPublicClient: () => ({ readContract: readContractMock }),
  __resetRpc: () => {},
}));

const { checkApproval } = await import('../../src/tools/check_approval.js');

const OWNER = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const SELL = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const MAX = 115792089237316195423570985008687907853269984665640564039457584007913129639935n;

describe('cow_check_approval', () => {
  beforeEach(() => {
    readContractMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports approved=true when allowance is MAX_UINT256', async () => {
    readContractMock.mockResolvedValue(MAX);
    const out = await checkApproval({ chainId: 1, owner: OWNER, sellToken: SELL });
    expect(out.approved).toBe(true);
    expect(out.allowance).toBe(MAX.toString());
    expect(out.spender).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('reports approved=false when allowance is 0', async () => {
    readContractMock.mockResolvedValue(0n);
    const out = await checkApproval({ chainId: 1, owner: OWNER, sellToken: SELL });
    expect(out.approved).toBe(false);
    expect(out.allowance).toBe('0');
  });

  it('reports approved=false for a small finite allowance', async () => {
    readContractMock.mockResolvedValue(123456n);
    const out = await checkApproval({ chainId: 1, owner: OWNER, sellToken: SELL });
    expect(out.approved).toBe(false);
  });
});
