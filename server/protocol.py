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
    # ★★ round424：头顶称号选哪个榜（用户：可以开也可以关 ✓）
    'ranktitle': {
        'req': [], 'opt': ['board'],
        'doc': '头顶称号：board = level|gold|kills|mq|time 或空字符串（= 关）',
    },
    'safetp': {
        'req': [], 'opt': [],
        'doc': '请求传送回安全区。服务端开始读条 6 秒，'
               '读条期间受到任何伤害都会取消；读完才真的把人挪过去',
    },
    'run': {
        'req': ['on'], 'opt': [],
        'doc': '跑步开/关：on=1 开始跑（每秒消耗 1 点灵气），on=0 停',
    },
    'warehouse_open': {
        'req': [], 'opt': [],
        'doc': '在仓库柜台旁打开仓库（服务端校验距离，返回 warehouse）',
    },
    'warehouse_move': {
        'req': ['id', 'to'], 'opt': [],
        'doc': '仓库存取：id=物品 id，to=store|bag',
    },
    'warehouse_move_many': {
        'req': ['ids', 'to'], 'opt': [],
        'doc': '批量仓库存取：ids=物品 id 数组，to=store|bag',
    },
    'house_info': {
        'req': [], 'opt': ['id'],
        'doc': '靠近住宅时查询房屋状态（也可只查最近一套）',
    },
    'house_buy': {
        'req': ['id', 'days'], 'opt': [],
        'doc': '购买/续期/买断住宅：days = 想要的总天数 1..7',
    },
    'order_open': {
        'req': [], 'opt': [],
        'doc': '坐下后点单（只对堂食店有效）',
    },
    'order_buy': {
        'req': ['item'], 'opt': [],
        'doc': '点单购买：item=菜单 key，菜直接送到桌上（进背包）',
    },
    'order_close': {
        'req': [], 'opt': [],
        'doc': '关闭点单',
    },
    'cup_take': {
        'req': ['slot'], 'opt': ['table', 'drink'],
        'doc': '喝掉/收走桌上的杯子：table=tbl<id>（缺省用当前座位），drink=1 喝掉并生效',
    },
    'work_start': {
        'req': ['id', 'slot'], 'opt': [],
        'doc': '开始打工：id=商店，slot=岗位',
    },
    'work_stop': {
        'req': [], 'opt': [],
        'doc': '结束打工',
    },
    'jobstep': {
        'req': ['t'], 'opt': [],
        'doc': '打工动画阶段播报（服务端广播）',
    },
    'jobdone': {
        'req': ['exp', 'pay'], 'opt': [],
        'doc': '一次打工结算（服务端校验后给经验/金币）',
    },
    'fridge_open': {
        'req': ['id'], 'opt': [],
        'doc': '房主打开自己住宅的冰箱：id=住宅 id',
    },
    'fridge_put': {
        'req': ['id', 'iid'], 'opt': [],
        'doc': '把背包里的一件饮料/食品放进冰箱',
    },
    'fridge_take': {
        'req': ['id', 'slot'], 'opt': [],
        'doc': '从冰箱取出一件到背包',
    },
    'fridge_close': {
        'req': [], 'opt': [],
        'doc': '关闭冰箱',
    },
    'shop_open': {
        'req': ['id'], 'opt': [],
        'doc': '靠近店员打开商店：id=商店 k',
    },
    'shop_buy': {
        'req': ['id', 'item'], 'opt': [],
        'doc': '购买商品：id=商店 k，item=商品 key；商品进背包',
    },
    'shop_close': {
        'req': [], 'opt': [],
        'doc': '关闭商店',
    },
    'house_sleep': {
        'req': ['id'], 'opt': [],
        'doc': '房主在自己的床上睡觉（服务端校验所有权/床距离）',
    },
    'house_wake': {
        'req': [], 'opt': [],
        'doc': '起床',
    },
    'house_leave': {
        'req': ['id'], 'opt': [],
        'doc': '主动退房：剩余天数退 50%',
    },
    'teleport': {
        'req': ['id'], 'opt': [],
        'doc': '在传送阵上传送到另一个传送点（服务端校验距离/冷却）',
    },
    'sit': {
        'req': ['id'], 'opt': [],
        'doc': '坐下：id = 椅子序号（服务端校验距离，回 seated）',
    },
    'stand': {
        'req': [], 'opt': [],
        'doc': '从椅子上起身（服务端把人挪到椅子旁边的空位）',
    },
    'warehouse_close': {
        'req': [], 'opt': [],
        'doc': '关闭仓库面板',
    },
    'spawn': {
        'req': [], 'opt': ['n', 'clear'],
        'doc': '调试用：让服务器刷 / 清附近的妖兽',
    },
    'pick': {
        'req': ['id'], 'opt': [],
        'doc': '捡地上掉的（P2 第二刀）。★ 服务器会再判一次距离，客户端说捡到了不算数',
    },
    # ★ 第 116 轮：天赋加点（方案 docs/天赋方案.md §7.1）
    'talent': {
        'req': ['op'],              # 'add' | 'reset'
        'opt': ['stat', 'n'],       # stat=12 个 key 之一 · n=1~50
    },
    # ★ round466：装备自动出售阈值（0 = 关，N = 低于 N 阶自动卖）✓
    'autosell': {
        'req': ['tier'], 'opt': [],
        'doc': '自动出售：低于 tier 阶的装备，拾取来当场卖成金币',
    },
    # ★ round485：换皮肤（没解锁 / 被别人独占 → 服务器拒绝）
    'setskin': {
        'req': ['key'], 'opt': [],
        'doc': '换皮肤：key 必须是已解锁且当前可用的',
    },
    # ★ round485：要一份皮肤页数据（40 个的状态 + 榜单 + 起拍/加价）
    'skinask': {
        'req': [], 'opt': [],
        'doc': '请求皮肤页（open 皮肤页时）',
    },
    # ★ round496：公告看完了（关掉弹窗那一刻发）
    'annread': {
        'req': ['id'], 'opt': [],
        'doc': '标记公告已读：id=公告 id（服务器只增不减）',
    },
    # ★ round487：用背包里的皮肤卡解锁皮肤
    'useskin': {
        'req': ['iid', 'key'], 'opt': [],
        'doc': '使用皮肤卡：iid=背包物品 id，key=皮肤 key',
    },
    # ★ round485：皮肤独占竞价（金币，扣了不退，可累计）
    # ★★ round510：皮肤自定义（捏脸/染色）
    'skincustomask': {
        'req': [], 'opt': [],
        'doc': '拉取我自己所有皮肤的【自定义】（瞳色/发色/衣服色/眼型/嘴型），返回 skincustomok',
    },
    'skincustom': {
        'req': ['skin', 'field', 'value'], 'opt': [],
        'doc': '确认更换一个部位：field = ey/mo/iris/hair/shirt ✗ 消耗【该皮肤】的重复卡 1 张 ✓',
    },
    # ★★ round538：技能系统（学习/装配/遗忘/使用技能书）
    'skillask': {
        'req': [], 'opt': [],
        'doc': '拉技能定义 + 我的学习/装配 + 冷却，返回 skillok',
    },
    'skilllearn': {
        'req': ['key'], 'opt': ['tier'],
        'doc': '学一个技能（每类上限 20；钥匙由服务端校验）',
    },
    'skillforget': {
        'req': ['key'], 'opt': [],
        'doc': '遗忘一个技能（不返还；装在槽里的要先卸下）',
    },
    'skillload': {
        'req': ['kind', 'slot'], 'opt': ['key'],
        'doc': '装配/卸下：key 空 = 卸下该槽',
    },
    'skillcast': {
        'req': ['key'], 'opt': ['x', 'z', 'yaw'],
        'doc': '释放主动技能：x/z 是落点（不传 = 自动打最近的怪）',
    },
    'useitem': {
        'req': ['iid'], 'opt': [],
        'doc': '使用背包里的食品/饮料：服务端校验并扣 1 个',
    },
    'useskillbook': {
        'req': ['iid'], 'opt': [],
        'doc': '使用背包里的技能书（学技能，书会消耗）',
    },
    'skinbid': {
        'req': ['key', 'amount'], 'opt': [],
        'doc': '给某个皮肤加价 amount 金币（第一次 ≥ 20000，之后每次 ≥ 5000）',
    },
    # ★ round465：要一份最新的属性表（打开属性页时）✓
    'statask': {
        'req': [], 'opt': [],
        'doc': '请求属性总览（服务器算好的完整表）',
    },
    'party': {
        'req': ['op'], 'opt': ['cid', 'text'],
        'doc': '队伍操作（op=invite/accept/decline/leave/kick/promote/disband/chat）',
    },
    'equiparmor': {
        'req': ['itemId'], 'opt': [],
        'doc': '穿防具（itemId 是背包里那件的 id）',
    },
    'unequiparmor': {
        'req': [], 'opt': [],
        'doc': '脱下防具',
    },
    'equip': {
        'req': ['itemId'], 'opt': [],
        'doc': '装上一件武器（第 47 轮）。★ 服务器查库校验：是不是他的 / 是不是武器 / 等级够不够',
    },
    'unequip': {
        'req': [], 'opt': []
,
        'doc': '脱下武器（第 47 轮）→ 服务器换回默认单手剑',
    },
    'ping': {
        'req': [], 'opt': ['t'],
        'doc': '测延迟，服务端原样回 pong',
    },
    'respawn': {
        'req': [], 'opt': [],
        'doc': '回到出生点（调试用）',
    },
    # ---------------- round304：交易所 ----------------
    #   ★ sid 是【幂等键】✗ 客户端每次操作生成一个唯一的
    #     重复发同一个 sid → 服务器回上次的结果 ✗ 不会成交两次 ✓
    #   ★ 格式必须是 't<启动毫秒>.<序号>'（不能是进程内自增 ✗ 重启后会撞主键 ✓）
    'mklist': {
        'req': ['iid', 'price'], 'opt': ['sid'],
        'doc': '上架：把背包里 id=iid 的东西挂 price 金币卖。★ 要收上架费（1%✗1~100✗余额<1000 免）',
    },
    'buyitem': {
        'req': ['lid'], 'opt': ['sid'],
        'doc': '买下货架上 lid 那一件。★ 服务器查余额、查是不是自己的、算 5% 税',
    },
    'unlist': {
        'req': ['lid'], 'opt': [],
        'doc': '下架：东西原样退回背包 ✗ 上架费不退',
    },
    'listclaim': {
        'req': ['lid'], 'opt': [],
        'doc': '领取：过期/下架失败时东西还在货架上 ✗ 清出背包空位后点这个拿回来',
    },
    # ★★★ round411（用户："点上锁显示未知消息类型 baglock"）★★★
    #   病根：_handle_intent 里写了分支 ✗ 但【协议白名单 C2S】里没登记 ✓
    #     → check_c2s 直接拦下 "未知消息类型 'baglock'" ✗
    #       根本没进 tick ✓（所以上锁永远不生效 ✗ 嵌套测试也测不到 ✓）
    #   ★ 教训：加新意图要【两处】✗协议表 + _handle_intent ✓
    #     协议表漏了就是"点了没反应 + 弹一个看不懂的错误"（用户截图就是这个 ✓）
    # ★ round411：调试按钮那条意图也登记上 ✗
    #   它在 _handle_intent 里是【故意拒绝】的（不能自己给自己发武器）✓
    #   不登记的话客户端只会看到"未知消息类型"✗ 看不到"已禁用"✓
    'giveweapon': {
        'req': [], 'opt': [],
        'doc': '已禁用。服务端会回一句提醒（防止任意玩家自己发武器）',
    },
    'baglock': {
        'req': ['iid', 'lock'], 'opt': [],
        'doc': '背包物品上锁/解锁（lock=1 上锁 ✗ 0 解锁）。'
               '锁住的不能卖系统/不能挂交易所/不会被批量出售',
    },
    # ★ round304v（用户："增加一个一键整理的按钮，按分类和种类品质进行排序"）
    #   ★ 走网络线程（要读库+写库 ✗ 和 equip 同一类 ✓ 绝不进 tick ✓）
    'bagsort': {
        'req': [], 'opt': [],
        'doc': '一键整理背包：**品阶高的在前**，同品阶再按类型（武器→防具→材料→其它）→小类→物品等级（写进 slot_index）',
    },
    # ★ round306（地形）：掉落伤害
    #   ★ 客户端算落差 ✗ 服务端【必须夹住】✓
    #     规则（用户 2026-10-17 定）：落差 ≥3 格起算 ✗ 每格 5 点 ✓
    #     ★ 完整防作弊在 P3（服务端自己按地形算落差 ✓）
    #       现在至少不能让"改包"变成自杀或者刷血 ✓
    # ★ round310（P1 破坏）：打一格地形
    #   ★ 客户端只是"请求"✗ 服务端验距离 / 算材质硬度 / 扣耐久 ✓
    # ★ round329（P1 树木破坏）：砍树 / 砸石头
    'mineprop': {
        'req': ['gx', 'gz'], 'opt': [],
        'doc': '砍一格物件：服务端用 worldgen 验"这格真有东西"，按种类累计，够了就消失',
    },
    'mine': {
        'req': ['gx', 'gz'], 'opt': [],
        'doc': '打地形：服务端按材质硬度累计，够了就高度 −1 并广播给附近的人',
    },
    'falldmg': {
        'req': ['d'], 'opt': [],
        'doc': '摔落伤害：客户端报"该掉多少血"，服务端夹到 0~60 再扣（P3 改为服务端自算）',
    },
    'lists': {
        'req': [], 'opt': ['page', 'cat', 'sort', 'q', 'tier', 'afford'],
        'doc': '看货架：分类/排序/搜索/分页（全部在内存里做 ✗ 不查库）',
    },
    # ★ round304c：打开交易所（客户端发 ✓ 和 lists 的区别只有一个字：要不要读库）
    #   lists   = 翻页/换分类/搜索 → 内存里重算 ✓ 绝不查库 ✓（高频 ✓）
    #   mktopen = "我刚打开面板 / 我刚捡了东西" → 网络线程重新读库 ✓
    #             （全服在售 + 我此刻的背包 ✗ 低频 ✓）
    'mktopen': {
        'req': [], 'opt': ['page', 'cat', 'sort', 'q', 'tier', 'afford'],
        'doc': '打开交易所：重新读一次库（全服在售 + 我的背包）再回第一页 ✓',
    },
    'mylists': {
        'req': [], 'opt': [],
        'doc': '我的上架（含过期待领取的 ✓）',
    },
    # ★ round304b：货架装载【不是客户端发的】✗ 是网络线程在登录时自己投的 ✓
    #   为什么也登记在这张表里：check_c2s 会拒掉没注册的类型 ✗
    #   不登记的话这条内部消息会被当场拒掉 ✓（第 304a 轮记过的坑 ✓）
    'mktload': {
        'req': [], 'opt': ['rows'],
        'doc': '内部：登录时把【全服在售】交给 tick 线程装进内存（客户端不发 ✓）',
    },
    # ---------------- v4 多小镇 ----------------
    'town_list': {'req': [], 'opt': [], 'doc': '我的小镇 + 小镇目录'},
    'town_create': {'req': ['name', 'tier', 'x', 'z'], 'opt': [],
                    'doc': '创建玩家小镇（扣首日费用）'},
    'town_perm_list': {'req': ['id'], 'opt': [], 'doc': '读取小镇权限'},
    'town_perm_set': {'req': ['id', 'player', 'mask'], 'opt': [],
                      'doc': '设置某玩家的小镇权限'},
    'town_restore': {'req': ['id'], 'opt': ['x', 'z'], 'doc': '恢复冻结小镇'},
    'town_dissolve': {'req': ['id'], 'opt': [], 'doc': '主动解散小镇'},
    'town_catalog': {
        'req': [], 'opt': [],
        'doc': '拉取小镇可放置目录',
    },
    'place': {
        'req': ['catalog', 'x', 'z'], 'opt': ['rot'],
        'doc': '放置单个物件（家具/装饰/功能物）',
    },
    'place_building': {
        'req': ['catalog', 'x', 'z'], 'opt': ['rot'],
        'doc': '放置建筑：同时按布局生成默认家具',
    },
    'move_object': {
        'req': ['id', 'x', 'z'], 'opt': ['rot'],
        'doc': '移动已放置物件',
    },
    'remove_object': {
        'req': ['id'], 'opt': ['cascade'],
        'doc': '移除物件（建筑会连带移除其默认家具）',
    },
    'town_objects': {
        'req': [], 'opt': [],
        'doc': '拉取当前小镇的已放置物件',
    },
    'townresult': {
        'req': ['ok'], 'opt': ['msg', 'town'],
        'doc': '小镇操作结果',
    },
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
    # ★ round412（用户："上锁后得刷新才能看到图标"）
    #   客户端拿它直接改那一格 ✗ 不去拉 /api/bag（落库还没好 ✗ 拿回来的是旧数据）
    # ★ round507：一键整理的回执 = 新的顺序（纯 id 数组 ✓ 客户端就地重排 ✗ 不再重拉）
    'bagsortok': {
        'req': ['ids'], 'opt': [],
        'doc': '背包整理完成：按新的顺序给出物品 id（客户端按这个数组重排 BAG.items）',
    },
    # ★ round510：自定义数据回执（{skin: {ey,mo,iris,hair,shirt}}，客户端直接用 ✓）
    # ★ round538：技能全量状态
    'skillok': {
        'req': [], 'opt': ['defs', 'learn', 'load', 'cd', 'qi'],
        'doc': '技能定义 + 我的学习（key→{tier}）+ 装配（kind→[5 槽]）+ 冷却剩余',
    },
    'skillfx': {
        'req': ['k'], 'opt': ['x', 'z', 'r', 'yaw', 'seed', 'dur'],
        'doc': '技能特效广播（所有人看到同一套动画 ✓ seed 保证随机数一致）',
    },
    'skillcd': {
        'req': [], 'opt': ['cd'],
        'doc': '我的技能冷却（{技能key: 剩余秒}）',
    },
    'skillerr': {
        'req': ['msg'], 'opt': [],
        'doc': '技能操作失败的原因',
    },
    'skincustomok': {
        'req': [], 'opt': ['custom', 'skin'],
        'doc': '我的皮肤自定义（custom = {皮肤key: {ey,mo,iris,hair,shirt}} ✗ 下标形式 ✓）',
    },
    'baglockok': {
        'req': ['iid', 'lock'], 'opt': ['name'],
        'doc': '背包物品上锁/解锁成功（lock=1 上锁 ✗ 0 解锁）',
    },
    # ★ round549：灵气变化 / 技能冷却
    'qi': {
        'req': ['q'], 'opt': [],
        'doc': '我的当前灵气（放技能后推）',
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
    'houses': {
        'req': ['list'], 'opt': [],
        'doc': '全部住宅状态（id/价格/房主/剩余天数）',
    },
    'worksettle': {
        'req': ['hours', 'exp', 'pay'], 'opt': [],
        'doc': 'work settlement (server timed)',
    },
    'jobround': {
        'req': ['n'], 'opt': [],
        'doc': 'work animation round done',
    },
    'eatfx': {
        'req': ['name'], 'opt': ['model', 'hp', 'qi'],
        'doc': 'eat/drink effect broadcast',
    },
    'order': {
        'req': [], 'opt': ['ok', 'msg', 'id', 'name', 'items', 'gold', 'table', 'order'],
        'doc': '点单/上菜结果（table = 桌位状态，含杯位）',
    },
    'tablecups': {
        'req': ['table'], 'opt': [],
        'doc': '一张桌子的当前杯位（上菜后广播给附近的人）',
    },
    'towncleared': {
        'req': ['x', 'z'], 'opt': ['r', 'town'],
        'doc': '小镇被冻结/解散：把以 (x,z) 为圆心、半径 r 内的放置物从客户端撤掉',
    },
    'townzones': {
        'req': ['list'], 'opt': [],
        'doc': '公开的小镇范围（id/name/x/z/size/status/system/owner），地图选点与安全区视觉用',
    },
    'waiter': {
        'req': ['id', 'path'], 'opt': ['shop', 'table', 'secs'],
        'doc': '传菜员出餐：path=[[x,z],...] 世界坐标，secs=走完全程的秒数',
    },
    'work': {
        'req': [], 'opt': ['ok', 'msg', 'id', 'slot', 'on'],
        'doc': '打工开始/结束',
    },
    'jobstep': {
        'req': ['cid'], 'opt': ['job', 't', 'x', 'z'],
        'doc': '别人正在打工的动画阶段',
    },
    'fridge': {
        'req': [], 'opt': ['ok', 'msg', 'house', 'mine', 'cap', 'items'],
        'doc': '冰箱内容/操作结果',
    },
    'shop': {
        'req': [], 'opt': ['ok', 'msg', 'id', 'name', 'gold', 'items', 'bagsig'],
        'doc': '商店数据/购买结果',
    },
    'sleep_state': {
        'req': ['on'], 'opt': ['id', 'x', 'z'],
        'doc': '睡眠状态：on=1 睡着，on=0 起床',
    },
    'house': {
        'req': [], 'opt': ['ok', 'msg', 'id', 'list'],
        'doc': '房屋操作结果 / 单套详情',
    },
    'teleported': {
        'req': ['id', 'x', 'z'], 'opt': ['name'],
        'doc': '传送完成：目标点与落点',
    },
    'seated': {
        'req': ['id'], 'opt': ['x', 'z', 'yaw', 'label'],
        'doc': '坐下成功：id=椅子序号，x/z/yaw=吸附后的位置',
    },
    'stood': {
        'req': [], 'opt': ['x', 'z', 'yaw'],
        'doc': '起身成功：x/z/yaw=椅子旁边的落脚点',
    },
    'notice': {
        'req': ['text'], 'opt': ['level'],
        'doc': '系统提示（升级、突破、掉落…）',
    },
    # ★ round424：头顶称号设置的回执（text 是当前名次算出来的称号，'' = 没进前 100）
    'ranktitleok': {
        'req': ['board'], 'opt': ['text', 'medal'],
        'doc': '头顶称号已设置',
    },
    'snd': {
        'req': ['name'], 'opt': ['x', 'z', 'by'],
        'doc': '音效事件（单独发，不进 world 快照）',
    },
    # ---------------- round304：交易所 ----------------
    'listres': {
        'req': ['ok'], 'opt': ['msg', 'lid', 'kind', 'gold', 'name', 'price'],
        'doc': '交易所操作的结果（上架/购买/下架/领取都走这条 ✓）'
               '★ msg 由服务器写好 ✗ 客户端【不要自己编文案】✓（方案 v1 §5）',
    },
    'listpage': {
        'req': ['rows'], 'opt': ['total', 'page', 'pages', 'mine', 'gold', 'fee'],
        'doc': '货架一页：rows=当前页的商品（含图标要用的字段 ✓）'
               '★ 只发当前页 ✗ 几千件不一次发 ✓（方案 v3 §8b）',
    },
}



# ---------------------------------------------------------------- 服务端 → 客户端
# 只登记需要校验/文档化的下行消息；其余直接 pack 发送
S2C = {
    'welcome': {
        'req': ['role'], 'opt': ['cfg', 'ver', 'ts'],
        'doc': '认证通过：角色数据 + 服务端配置',
    },
    'error': {
        'req': ['msg'], 'opt': ['code'],
        'doc': '出错了',
    },
    'world': {
        'req': ['ts'], 'opt': ['players', 'mobs', 'loot', 'hurts', 'mhits', 'me', 'snd'],
        'doc': '30Hz 世界快照',
    },
    'towns': {
        'req': ['list'], 'opt': ['catalog', 'owned', 'perms'],
        'doc': '小镇列表 / 目录',
    },
    'townresult': {
        'req': ['ok'], 'opt': ['msg', 'town'],
        'doc': '小镇操作结果',
    },
    'objects': {
        'req': ['town'], 'opt': ['list'],
        'doc': '当前小镇已放置物件 [id,catalog,x,z,rot,model,parent,floor]',
    },
    'placed': {
        'req': ['object'], 'opt': ['furniture'],
        'doc': '放置成功；furniture = 同时生成的默认家具数量',
    },
    'moved': {
        'req': ['object'], 'opt': [],
        'doc': '移动成功',
    },
    'removed': {
        'req': ['id'], 'opt': [],
        'doc': '移除成功',
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
