# -*- coding: utf-8 -*-
"""协议定义表（P0-5）—— 客户端 / 服务端共用一份

原则：
  · 一条消息 = 一段 UTF-8 JSON 文本：{"t": 类型, "d": {...}}
    选文本不选二进制：P0 阶段好调试、好抓包；等 P5 压测再对高频消息
    （move / world）做 int16 量化，接口不变（见方案 §13.2）
  · 版本号必须对得上，不然一律拒 —— 免得老客户端连新服务端出现"诡异不同步"
  · 类型表就是唯一的真相，加消息 = 往下面两张表加一行

消息量级（方案 §13.2 的预算）：
  move 上行  ≈ 60 字节 × 30Hz ≈ 1.8 KB/s
  world 下行 ≈ 1.5 KB   × 30Hz ≈ 45 KB/s
"""

PROTOCOL_VERSION = 1

# ---------------------------------------------------------------- 客户端 → 服务端
# req = 必填字段；opt = 可选字段
C2S = {
    'hello': {
        'req': [], 'opt': ['token', 'ver'],
        'doc': '第一件事：带 token 认证 + 版本协商。成功后服务端回 welcome',
    },
    'move': {
        'req': ['x', 'z'], 'opt': ['yaw', 't', 'hp', 'qi', 'atk'],
        'doc': '位置同步，30Hz。x/z 世界坐标，yaw 朝向，t 是客户端自己的钟（做插值用）',
    },
    'atk': {
        'req': [], 'opt': ['seq', 'mid', 'uid', 'dir'],
        'doc': '挥了一刀。★ 服务器算伤害：mid/uid 只是客户端以为的目标，'
               '服务端一律按【自己的位置+朝向】重算扇形命中（不信任客户端报的目标）',
    },
    'skill': {
        'req': ['slot'], 'opt': ['x', 'z', 'aim'],
        'doc': '放技能：slot 是技能页上的位置（0~3），目标坐标由服务端校验',
    },
    'dead': {
        'req': [], 'opt': [],
        'doc': '客户端上报自己躺了（服务端会核验）',
    },
    'revive': {
        'req': [], 'opt': [],
        'doc': '请求复活',
    },
    'team': {
        'req': ['action'], 'opt': ['name'],
        'doc': '组队：action = invite|accept|leave|kick|disband|list',
    },
    'chat': {
        'req': ['text'], 'opt': ['ch'],
        'doc': '聊天：ch = world|team',
    },
    'pvp': {
        'req': ['on'], 'opt': [],
        'doc': '开关「玩家互相伤害」（服务器全局开关）',
    },
    'spawn': {
        'req': [], 'opt': ['n', 'clear'],
        'doc': '调试用：让服务器刷 / 清附近的妖兽',
    },
    'pick': {
        'req': ['id'], 'opt': [],
        'doc': '捡地上掉的（P2 第二刀）。★ 服务器会再判一次距离，客户端说捡到了不算数',
    },
    'ping': {
        'req': [], 'opt': ['t'],
        'doc': '测延迟，服务端原样回 pong',
    },
    'respawn': {
        'req': [], 'opt': [],
        'doc': '回到出生点（调试用）',
    },
}

# ---------------------------------------------------------------- 服务端 → 客户端
S2C = {
    'welcome': {
        'req': ['role'], 'opt': ['cfg', 'ver', 'ts'],
        'doc': '认证通过：下发角色数据 + 服务端配置（视野半径、tick 频率等）',
    },
    'error': {
        'req': ['msg'], 'opt': ['code'],
        'doc': '出错了：msg 直接可以给玩家看',
    },
    'kick': {
        'req': [], 'opt': ['msg', 'code'],
        'doc': '被踢下线（重复登录 / 封号 / 服务端维护）',
    },
    'world': {
        'req': ['ts'], 'opt': ['players', 'mobs', 'loot', 'hurts', 'mhits', 'me', 'snd', 'pvp'],
        'doc': '30Hz 世界快照。players/mobs/loot 只含兴趣范围内的实体（方案 §13.2）。'
               'hurts=我挨的打，mhits=我打中僵尸（弹伤害数字用），me=我的经验/等级（变了才带），'
               'loot=地上掉的 [id,x,z,name,tier]',
    },
    'pong': {
        'req': [], 'opt': ['t', 'st'],
        'doc': 'ping 的回包，st 是服务端时间',
    },
    'hurt': {
        'req': ['hp'], 'opt': ['by', 'kind', 'x', 'z'],
        'doc': '自己掉血',
    },
    'dead': {
        'req': [], 'opt': ['by'],
        'doc': '自己死了',
    },
    'revived': {
        'req': [], 'opt': ['x', 'z', 'hp'],
        'doc': '复活了',
    },
    'team': {
        'req': ['members'], 'opt': ['action'],
        'doc': '队伍状态变化',
    },
    'chat': {
        'req': ['from', 'text'], 'opt': ['ch'],
        'doc': '收到聊天',
    },
    'notice': {
        'req': ['text'], 'opt': ['level'],
        'doc': '系统提示（升级、突破、掉落…）',
    },
    'snd': {
        'req': ['name'], 'opt': ['x', 'z', 'by'],
        'doc': '音效事件（单独发，不进 world 快照）',
    },
}


# ---------------------------------------------------------------- 打包 / 拆包

def pack(mtype, **d):
    """组包：pack('pong', t=1.5) → '{"t":"pong","d":{"t":1.5}}'

    ★ 形参名不能叫 t —— 消息体里也有个常见字段就叫 t（客户端自己的钟），
      叫 t 会撞成 "got multiple values for argument 't'"，
      服务端每次回 pong 都抛异常并断开连接（踩过）。
    """
    return '{"t":%s,"d":%s}' % (_js(mtype), _js(d))


def pack_str(mtype, d):
    return '{"t":%s,"d":%s}' % (_js(mtype), _js(d))


def _js(o):
    import json
    return json.dumps(o, ensure_ascii=False, separators=(',', ':'))


def unpack(text):
    """拆包 → (类型, 数据)；格式不对返回 (None, 错误说明)"""
    import json
    if not isinstance(text, str):
        return None, '不是文本消息'
    if len(text) > 1 << 20:
        return None, '消息太长'
    try:
        o = json.loads(text)
    except Exception:
        return None, '不是合法 JSON'
    if not isinstance(o, dict):
        return None, '顶层不是对象'
    t = o.get('t')
    if not isinstance(t, str):
        return None, '缺少消息类型 t'
    d = o.get('d')
    if d is None:
        d = {}
    if not isinstance(d, dict):
        return None, 'd 不是对象'
    return t, d


def check_c2s(t, d):
    """校验客户端消息：返回 None 表示 OK，否则返回错误说明"""
    spec = C2S.get(t)
    if spec is None:
        return '未知消息类型 %r' % t
    for k in spec['req']:
        if k not in d:
            return '%s 缺少字段 %s' % (t, k)
    return None


def describe():
    """打印协议表（自检 / 写文档用）"""
    out = ['协议版本 v%d' % PROTOCOL_VERSION, '', '客户端 → 服务端：']
    for k in sorted(C2S):
        out.append('  %-8s %s' % (k, C2S[k]['doc']))
    out.append('')
    out.append('服务端 → 客户端：')
    for k in sorted(S2C):
        out.append('  %-8s %s' % (k, S2C[k]['doc']))
    return '\n'.join(out)


if __name__ == '__main__':
    import sys
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    print(describe())
