from app import is_allowed


def test_allowlist():
    ok = [
        ('thornode', 'thorchain/network'),
        ('thornode', 'thorchain/pool/BSC.USDT-0X55D398326F99059FF775485246999027B3197955'),
        ('thornode', 'thorchain/pool/BTC.BTC/liquidity_provider/thor1j92uhr4gsyx7dzvncs92xh2stf48y6evka46na'),
        ('midgard', 'v2/member/bc1qn9g3l2mfqj8qaua8w5jrld2yparhrzmyg2rjld'),
        ('midgard', 'v2/actions'),
        ('midgard', 'v2/history/depths/ETH.ETH'),
    ]
    bad = [
        ('thornode', 'thorchain/pool/../../cosmos/tx'),
        ('thornode', 'cosmos/base/tendermint/v1beta1/node_info'),
        ('thornode', 'thorchain/pool/BTC.BTC/liquidity_providers'),
        ('midgard', 'v2/member/x/../../debug'),
        ('thornode', 'thorchain/pool/..'),
        ('other', 'v2/health'),
    ]
    assert all(is_allowed(u, p) for u, p in ok)
    assert not any(is_allowed(u, p) for u, p in bad)


if __name__ == '__main__':
    test_allowlist()
    print('ok')
