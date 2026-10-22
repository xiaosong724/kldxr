// 自动生成（tools/build_skin_rig.js）-- 别手改
/* ==================== SKINS BEGIN（由 tools/patch_skins.js 生成，别手改） ==================== */
/* 40 个皮肤的数据（由 tools/gen_skin_defs.js 从预览页生成 -- 不要手改）
   纯数据：没有 DOM、没有事件。字段：
   k=key n=名字 sx=体型说明 g=性别 sk=骨架参数 c=配色
   hair=发型 eyes=眼睛尺寸 outfit=服装 acc=配件 skirt=裙/袍 pin=发饰 */
var SKIN_DEFS = {
  "f01": {"k":"f01","n":"双马尾剑士","sx":"女 · 1.00","g":"f","sk":{"legW":0.22,"armW":0.18,"torsoW":0.82,"torsoD":0.52,"headW":1.03,"headH":0.99},"c":{"skin":16769228,"hair":14703194,"shirt":16054010,"shirtD":14212326,"pants":2764346,"boot":2764346,"belt":2238000,"gold":16765286,"collar":3824296,"iris":13647968,"sock":15790840,"apron":null,"skirt":2765896,"hair2":16743034,"hairS":10568001,"skinS":15125176,"shirtS":13488082,"skirtS":2239034,"iris2":8464444},"hair":"twintail","eyes":{"w":0.3,"h":0.34,"blush":1},"outfit":"sailor","skirt":{"top":0.92,"bot":1.34,"len":0.62,"seg":8},"pin":16765286},
  "f02": {"k":"f02","n":"巫女","sx":"女 · 1.02","g":"f","sk":{"legW":0.23,"armW":0.18,"torsoW":0.84,"torsoD":0.52,"headW":1.01,"headH":0.97},"c":{"skin":16769228,"hair":1710626,"shirt":16514047,"shirtD":15132398,"pants":14169132,"boot":2764346,"belt":2238000,"gold":16777215,"collar":16514047,"iris":9054778,"sock":16777215,"apron":null,"skirt":14169132,"hair2":2302766,"hairS":1250072,"skinS":15125176,"shirtS":13882326,"skirtS":11348515,"iris2":5642788},"hair":"hime","eyes":{"w":0.28,"h":0.32,"blush":1},"outfit":"miko","skirt":{"top":0.86,"bot":1.3,"len":0.86},"pin":14169132},
  "f03": {"k":"f03","n":"女仆","sx":"女 · 0.98","g":"f","sk":{"legW":0.22,"armW":0.17,"torsoW":0.8,"torsoD":0.5,"headW":1.01,"headH":0.97},"c":{"skin":16769228,"hair":9067066,"shirt":2763830,"shirtD":1842726,"pants":1316122,"boot":2764346,"belt":2238000,"gold":16777215,"collar":16777215,"iris":4885200,"sock":16054010,"apron":16316924,"skirt":1974054,"hair2":12221006,"hairS":6504746,"skinS":15125176,"shirtS":2303277,"skirtS":1579294,"iris2":3036801},"hair":"twintail","eyes":{"w":0.3,"h":0.34,"blush":1},"outfit":"maid","skirt":{"top":0.9,"bot":1.32,"len":0.6},"pin":16777215},
  "f04": {"k":"f04","n":"精灵射手","sx":"女 · 1.06","g":"f","sk":{"hipY":1,"legW":0.21,"armW":0.17,"armLen":1.02,"torsoW":0.78,"torsoD":0.48,"headW":0.95,"headH":0.92},"c":{"skin":16769228,"hair":15784072,"shirt":3832394,"shirtD":2776120,"pants":2767406,"boot":2764346,"belt":2238000,"gold":14205024,"collar":9097376,"iris":3842160,"sock":6982234,"apron":null,"skirt":2776120,"hair2":16777144,"hairS":11377762,"skinS":15125176,"shirtS":3237438,"skirtS":2247213,"iris2":2384709},"hair":"long","eyes":{"w":0.26,"h":0.3},"outfit":"plain","acc":"elfEar","skirt":{"top":0.8,"bot":1.06,"len":0.56}},
  "f05": {"k":"f05","n":"猫耳少女","sx":"女 · 0.94","g":"f","sk":{"hipY":0.84,"legW":0.22,"armW":0.17,"armLen":0.88,"torsoH":0.92,"torsoW":0.84,"torsoD":0.54,"headW":1.04,"headH":0.99},"c":{"skin":16769228,"hair":13134394,"shirt":15788252,"shirtD":14208184,"pants":3814472,"boot":2764346,"belt":2238000,"gold":16765286,"collar":16777215,"iris":14196784,"sock":2763312,"apron":null,"skirt":3814472,"hair2":16748366,"hairS":9456682,"skinS":15125176,"shirtS":13288377,"skirtS":3025466,"iris2":8807198},"hair":"bob","eyes":{"w":0.3,"h":0.34,"blush":1},"outfit":"hoodie","acc":"catEar","skirt":{"top":0.88,"bot":1.14,"len":0.46}},
  "f06": {"k":"f06","n":"水手服少女","sx":"女 · 1.00","g":"f","sk":{"legW":0.22,"armW":0.17,"torsoW":0.82,"torsoD":0.5,"headW":1.01,"headH":0.97},"c":{"skin":16769228,"hair":2763322,"shirt":16448767,"shirtD":15001840,"pants":2765904,"boot":2764346,"belt":2238000,"gold":16738954,"collar":2765904,"iris":5929680,"sock":16777215,"apron":null,"skirt":2765904,"hair2":3750222,"hairS":1973802,"skinS":15125176,"shirtS":13817046,"skirtS":2239040,"iris2":3689601},"hair":"bob","eyes":{"w":0.28,"h":0.32},"outfit":"sailor","skirt":{"top":0.92,"bot":1.32,"len":0.58}},
  "f07": {"k":"f07","n":"魔法少女","sx":"女 · 0.96","g":"f","sk":{"hipY":0.88,"legW":0.21,"armW":0.16,"armLen":0.9,"torsoH":0.94,"torsoW":0.82,"torsoD":0.52,"headW":1.04,"headH":1.01},"c":{"skin":16769228,"hair":15760040,"shirt":16773880,"shirtD":15782112,"pants":15760040,"boot":2764346,"belt":2238000,"gold":16769126,"collar":16747192,"iris":16734874,"sock":16777215,"apron":null,"skirt":16747192,"hair2":16754147,"hairS":11360377,"skinS":15125176,"shirtS":14076880,"skirtS":13397651,"iris2":10369119},"hair":"twintail","eyes":{"w":0.32,"h":0.36,"blush":1},"outfit":"frill","skirt":{"top":0.96,"bot":1.4,"len":0.54},"pin":16769126},
  "f08": {"k":"f08","n":"吸血鬼萝莉","sx":"女 · 0.90","g":"f","sk":{"hipY":0.8,"legW":0.21,"armW":0.16,"armLen":0.84,"torsoH":0.88,"torsoW":0.8,"torsoD":0.5,"headW":1.06,"headH":1.03},"c":{"skin":16510706,"hair":4860996,"shirt":3810360,"shirtD":2364968,"pants":1708064,"boot":2764346,"belt":2238000,"gold":13647952,"collar":13647952,"iris":13639728,"sock":1708064,"apron":null,"skirt":1708064,"hair2":6568796,"hairS":3481649,"skinS":14866138,"shirtS":3218991,"skirtS":1379610,"iris2":8459294},"hair":"long","eyes":{"w":0.32,"h":0.36},"outfit":"dress","acc":"batWing","skirt":{"top":0.94,"bot":1.28,"len":0.52}},
  "f09": {"k":"f09","n":"女骑士","sx":"女 · 1.05","g":"f","sk":{"hipY":0.98,"legW":0.26,"armW":0.21,"torsoW":0.88,"torsoD":0.58,"headW":0.95,"headH":0.94},"c":{"skin":16769228,"hair":14203000,"shirt":12108496,"shirtD":9740464,"pants":6976644,"boot":2764346,"belt":2238000,"gold":15782000,"collar":14674164,"iris":4881088,"sock":5923440,"apron":null,"skirt":6976644,"hair2":16775330,"hairS":10257494,"skinS":15125176,"shirtS":10199983,"skirtS":5594474,"iris2":3034231},"hair":"ponytail","eyes":{"w":0.26,"h":0.3},"outfit":"armorkirt","acc":"cape","skirt":{"top":0.88,"bot":1.16,"len":0.62}},
  "f10": {"k":"f10","n":"剑道少女","sx":"女 · 1.00","g":"f","sk":{"legW":0.24,"armW":0.19,"torsoW":0.86,"torsoD":0.54,"headW":0.99,"headH":0.95},"c":{"skin":16769228,"hair":2236970,"shirt":16316668,"shirtD":14737640,"pants":2763316,"boot":2764346,"belt":2238000,"gold":16777215,"collar":2763316,"iris":4868698,"sock":16316668,"apron":null,"skirt":2763316,"hair2":3026489,"hairS":1579038,"skinS":15125176,"shirtS":13684948,"skirtS":2236970,"iris2":3026488},"hair":"ponytail","eyes":{"w":0.26,"h":0.3},"outfit":"kendo","acc":"headband","skirt":{"top":0.88,"bot":1.28,"len":0.92}},
  "f11": {"k":"f11","n":"修女","sx":"女 · 1.02","g":"f","sk":{"hipY":0.94,"legW":0.23,"armW":0.18,"torsoW":0.84,"torsoD":0.52,"headW":0.99,"headH":0.95},"c":{"skin":16508632,"hair":2236970,"shirt":3026488,"shirtD":1973798,"pants":1973796,"boot":2764346,"belt":2238000,"gold":14674164,"collar":16054010,"iris":6982336,"sock":1973796,"apron":null,"skirt":1579039,"hair2":3026489,"hairS":1579038,"skinS":14864322,"shirtS":2565935,"skirtS":1250073,"iris2":4347511},"hair":"veil","eyes":{"w":0.26,"h":0.3},"outfit":"nun","skirt":{"top":0.9,"bot":1.3,"len":0.94}},
  "f12": {"k":"f12","n":"机械少女","sx":"女 · 1.00","g":"f","sk":{"legW":0.23,"armW":0.19,"torsoW":0.84,"torsoD":0.54,"headW":0.99,"headH":0.95},"c":{"skin":15918816,"hair":5949664,"shirt":2764856,"shirtD":1975340,"pants":2370098,"boot":2764346,"belt":2238000,"gold":16723872,"collar":712928,"iris":712928,"sock":2764856,"apron":null,"skirt":2370098,"hair2":8060927,"hairS":4296865,"skinS":14340042,"shirtS":2304047,"skirtS":1909288,"iris2":428939},"hair":"short","eyes":{"w":0.28,"h":0.32},"outfit":"mech","acc":"visor","skirt":{"top":0.92,"bot":1.2,"len":0.44}},
  "f13": {"k":"f13","n":"狐仙","sx":"女 · 1.04","g":"f","sk":{"hipY":0.96,"legW":0.22,"armW":0.17,"torsoW":0.82,"torsoD":0.52,"headW":1.01,"headH":0.97},"c":{"skin":16769228,"hair":12167394,"shirt":16643323,"shirtD":15389928,"pants":14206184,"boot":2764346,"belt":2238000,"gold":13658784,"collar":13658784,"iris":13658784,"sock":16777215,"apron":null,"skirt":15389934,"hair2":16442367,"hairS":8747427,"skinS":15125176,"shirtS":14011859,"skirtS":12298942,"iris2":8471139},"hair":"long","eyes":{"w":0.28,"h":0.32,"blush":1},"outfit":"hanfu","acc":"foxEar","skirt":{"top":0.84,"bot":1.18,"len":0.7}},
  "f14": {"k":"f14","n":"学生会长","sx":"女 · 1.02","g":"f","sk":{"legW":0.22,"armW":0.17,"torsoW":0.82,"torsoD":0.5,"headW":0.99,"headH":0.95},"c":{"skin":16769228,"hair":2761792,"shirt":16448767,"shirtD":14870254,"pants":2764346,"boot":2764346,"belt":2238000,"gold":16765286,"collar":2764346,"iris":10119888,"sock":1973796,"apron":null,"skirt":2764346,"hair2":3748182,"hairS":1972782,"skinS":15125176,"shirtS":13817046,"skirtS":2237742,"iris2":6242945},"hair":"hime","eyes":{"w":0.28,"h":0.32},"outfit":"sailor","acc":"glasses","skirt":{"top":0.92,"bot":1.3,"len":0.58}},
  "f15": {"k":"f15","n":"拳击少女","sx":"女 · 1.00","g":"f","sk":{"legW":0.25,"armW":0.21,"torsoW":0.84,"torsoD":0.54,"headW":0.99,"headH":0.95},"c":{"skin":16769228,"hair":14178346,"shirt":15790840,"shirtD":14211812,"pants":14178346,"boot":2764346,"belt":2238000,"gold":16765286,"collar":14178346,"iris":14196768,"sock":15790840,"apron":null,"skirt":14178346,"hair2":16742201,"hairS":10239774,"skinS":15125176,"shirtS":13290448,"skirtS":11355682,"iris2":8807188},"hair":"ponytail","eyes":{"w":0.28,"h":0.32},"outfit":"sport","acc":"gloves","skirt":{"top":0.94,"bot":1.18,"len":0.4}},
  "f16": {"k":"f16","n":"弓道少女","sx":"女 · 1.02","g":"f","sk":{"hipY":0.96,"legW":0.23,"armW":0.18,"torsoW":0.82,"torsoD":0.52,"headW":0.99,"headH":0.95},"c":{"skin":16769228,"hair":3811882,"shirt":16514047,"shirtD":15263984,"pants":3026490,"boot":2764346,"belt":2238000,"gold":15263984,"collar":3026490,"iris":6965818,"sock":16514047,"apron":null,"skirt":3026490,"hair2":5126457,"hairS":2760222,"skinS":15125176,"shirtS":13882326,"skirtS":2434350,"iris2":4337188},"hair":"hime","eyes":{"w":0.26,"h":0.3},"outfit":"kendo","acc":"ribbon","skirt":{"top":0.88,"bot":1.3,"len":0.96}},
  "f17": {"k":"f17","n":"丧尸少女","sx":"女 · 0.98","g":"f","sk":{"legW":0.23,"armW":0.17,"torsoW":0.82,"torsoD":0.52,"headW":1.01,"headH":0.97},"c":{"skin":14212296,"hair":3820090,"shirt":14212320,"shirtD":12106948,"pants":3818576,"boot":2764346,"belt":2238000,"gold":9054762,"collar":3818576,"iris":9093226,"sock":2764342,"apron":null,"skirt":3818576,"hair2":5137486,"hairS":2766122,"skinS":12764852,"shirtS":11909564,"skirtS":3028544,"iris2":5666626},"hair":"long","eyes":{"w":0.3,"h":0.34},"outfit":"sailor","acc":"blood","skirt":{"top":0.92,"bot":1.28,"len":0.56}},
  "f18": {"k":"f18","n":"天使","sx":"女 · 1.04","g":"f","sk":{"hipY":0.98,"legW":0.22,"armW":0.17,"torsoW":0.84,"torsoD":0.52,"headW":0.99,"headH":0.95},"c":{"skin":16769228,"hair":15912798,"shirt":16645631,"shirtD":14673138,"pants":16645631,"boot":2764346,"belt":2238000,"gold":16769126,"collar":15912798,"iris":5941472,"sock":16777215,"apron":null,"skirt":15659772,"hair2":16777087,"hairS":11441476,"skinS":15125176,"shirtS":14013910,"skirtS":12501706,"iris2":3696779},"hair":"long","eyes":{"w":0.28,"h":0.32},"outfit":"dress","acc":"halo","skirt":{"top":0.86,"bot":1.36,"len":0.98}},
  "f19": {"k":"f19","n":"恶魔","sx":"女 · 1.02","g":"f","sk":{"hipY":0.94,"legW":0.23,"armW":0.18,"torsoW":0.84,"torsoD":0.52,"headW":0.99,"headH":0.95},"c":{"skin":16769228,"hair":3810354,"shirt":4989492,"shirtD":3282986,"pants":1970200,"boot":2764346,"belt":2238000,"gold":16734826,"collar":13643856,"iris":16730714,"sock":1970200,"apron":null,"skirt":1970200,"hair2":5124420,"hairS":2759204,"skinS":15125176,"shirtS":4201772,"skirtS":1576211,"iris2":10366520},"hair":"twintail","eyes":{"w":0.3,"h":0.34},"outfit":"dress","acc":"demonHorn","skirt":{"top":0.92,"bot":1.3,"len":0.58},"pin":16734826},
  "f20": {"k":"f20","n":"雪女","sx":"女 · 1.03","g":"f","sk":{"hipY":0.98,"legW":0.21,"armW":0.16,"torsoW":0.8,"torsoD":0.5,"headW":0.97,"headH":0.94},"c":{"skin":16769228,"hair":9356008,"shirt":15398655,"shirtD":12376304,"pants":11061480,"boot":2764346,"belt":2238000,"gold":12574968,"collar":6990040,"iris":4889296,"sock":16777215,"apron":null,"skirt":14478586,"hair2":12648447,"hairS":6720679,"skinS":15125176,"shirtS":12963798,"skirtS":11582920,"iris2":3039105},"hair":"long","eyes":{"w":0.26,"h":0.3},"outfit":"hanfu","acc":"snow","skirt":{"top":0.84,"bot":1.36,"len":1}},
  "m01": {"k":"m01","n":"熔岩魔修","sx":"男 · 壮硕 · 1.10","g":"m","sk":{"hipY":0.86,"legW":0.4,"torsoH":1.04,"torsoW":1.22,"torsoD":0.78,"armLen":0.98,"armW":0.38,"headW":1.08,"headH":1},"c":{"skin":9061426,"hair":2757136,"shirt":3810332,"shirtD":2364945,"pants":2101774,"boot":2764346,"belt":16738848,"gold":16752704,"collar":3809304,"iris":4858648,"sock":null,"apron":null,"skirt":2101774,"hair2":3741718,"hairS":1969420,"skinS":8142125,"shirtS":3218968,"skirtS":1707531,"iris2":3020303},"hair":"bald","eyes":{"w":0.24,"h":0.24},"outfit":"plain","acc":"lava"},
  "m02": {"k":"m02","n":"侏儒炼金师","sx":"男 · 矮小 · 0.74","g":"m","sk":{"hipY":0.58,"legW":0.3,"torsoH":0.7,"torsoW":0.94,"torsoD":0.64,"armLen":0.66,"armW":0.26,"headW":1.28,"headH":1.18},"c":{"skin":15254682,"hair":12632264,"shirt":6969994,"shirtD":5128808,"pants":3814472,"boot":2764346,"belt":9075274,"gold":14205040,"collar":10128064,"iris":2763312,"sock":null,"apron":null,"skirt":3814472,"hair2":16777215,"hairS":9079440,"skinS":13742219,"shirtS":5852276,"skirtS":3025466,"iris2":1710622},"hair":"messy","eyes":{"w":0.26,"h":0.26},"outfit":"plain","acc":"goggles"},
  "m03": {"k":"m03","n":"僵尸王","sx":"男 · 驼背长臂 · 1.05","g":"m","sk":{"hipY":0.8,"legW":0.34,"torsoH":0.96,"torsoW":1.06,"torsoD":0.66,"armLen":1.16,"armW":0.32,"headW":1.08,"headH":1.02},"c":{"skin":10465418,"hair":3814440,"shirt":7039578,"shirtD":4868668,"pants":4868668,"boot":2764346,"belt":3815470,"gold":9054762,"collar":8026728,"iris":3358762,"sock":null,"apron":null,"skirt":4868668,"hair2":5129782,"hairS":2762013,"skinS":9412220,"shirtS":5921100,"skirtS":3881776,"iris2":2107418},"hair":"messy","eyes":{"w":0.26,"h":0.26},"outfit":"plain","acc":"blood"},
  "m04": {"k":"m04","n":"赤膊狂战","sx":"男 · 粗壮 · 1.09","g":"m","sk":{"hipY":0.82,"legW":0.42,"torsoH":1.02,"torsoW":1.28,"torsoD":0.82,"armLen":1,"armW":0.42,"headW":1.1,"headH":1.02},"c":{"skin":14263928,"hair":9054746,"shirt":14263928,"shirtD":12617816,"pants":6965802,"boot":2764346,"belt":4860442,"gold":9054746,"collar":14263928,"iris":3811866,"sock":null,"apron":null,"skirt":6965802,"hair2":12204323,"hairS":6495763,"skinS":12817772,"shirtS":11963237,"skirtS":5585698,"iris2":2365968},"hair":"bald","eyes":{"w":0.24,"h":0.24},"outfit":"sport","acc":"gloves"},
  "m05": {"k":"m05","n":"龙裔","sx":"男 · 高壮 · 1.12","g":"m","sk":{"hipY":0.98,"legW":0.38,"torsoH":1.06,"torsoW":1.2,"torsoD":0.74,"armLen":1.02,"armW":0.36,"headW":1.06,"headH":1},"c":{"skin":9089136,"hair":1714714,"shirt":3828298,"shirtD":2773048,"pants":2771508,"boot":2764346,"belt":14205024,"gold":14205024,"collar":14205024,"iris":3814424,"sock":null,"apron":null,"skirt":2771508,"hair2":2308387,"hairS":1252883,"skinS":8167013,"shirtS":3234110,"skirtS":2243370,"iris2":2367503},"hair":"messy","eyes":{"w":0.26,"h":0.26},"outfit":"robe","acc":"demonHorn"},
  "m06": {"k":"m06","n":"少年剑士","sx":"男 · 少年 · 0.88","g":"m","sk":{"hipY":0.74,"legW":0.3,"torsoH":0.86,"torsoW":0.96,"torsoD":0.6,"armLen":0.82,"armW":0.26,"headW":1.14,"headH":1.1},"c":{"skin":16769228,"hair":3811866,"shirt":14200928,"shirtD":11569722,"pants":6969914,"boot":2764346,"belt":6965802,"gold":16765286,"collar":15784080,"iris":3025446,"sock":null,"apron":null,"skirt":6969914,"hair2":5126435,"hairS":2760211,"skinS":15125176,"shirtS":11899985,"skirtS":5589038,"iris2":1907224},"hair":"topknot","eyes":{"w":0.28,"h":0.28},"outfit":"kendo"},
  "m07": {"k":"m07","n":"学园不良","sx":"男 · 少年 · 0.94","g":"m","sk":{"hipY":0.86,"legW":0.3,"torsoH":0.96,"torsoW":1,"torsoD":0.62,"armLen":0.9,"armW":0.26,"headW":1.08,"headH":1.04},"c":{"skin":16769228,"hair":2763312,"shirt":2764346,"shirtD":1974828,"pants":2237998,"boot":2764346,"belt":1382172,"gold":12595248,"collar":3817552,"iris":2762288,"sock":null,"apron":null,"skirt":2237998,"hair2":3750209,"hairS":1973795,"skinS":15125176,"shirtS":2303793,"skirtS":1777189,"iris2":1710110},"hair":"spiky","eyes":{"w":0.26,"h":0.26},"outfit":"sailor"},
  "m08": {"k":"m08","n":"和风武士","sx":"男 · 精瘦 · 1.04","g":"m","sk":{"hipY":0.94,"legW":0.28,"torsoH":1,"torsoW":0.92,"torsoD":0.58,"armLen":0.98,"armW":0.24,"headW":1.04,"headH":1},"c":{"skin":16769228,"hair":1710624,"shirt":2767450,"shirtD":1976900,"pants":3816004,"boot":2764346,"belt":9050650,"gold":14674164,"collar":14674164,"iris":2500142,"sock":null,"apron":null,"skirt":3816004,"hair2":2302763,"hairS":1250071,"skinS":15125176,"shirtS":2306380,"skirtS":3026486,"iris2":1579037},"hair":"topknot","eyes":{"w":0.24,"h":0.24},"outfit":"robe"},
  "m09": {"k":"m09","n":"忍者","sx":"男 · 精瘦 · 1.00","g":"m","sk":{"hipY":0.9,"legW":0.26,"torsoH":0.98,"torsoW":0.88,"torsoD":0.56,"armLen":0.96,"armW":0.23,"headW":1.04,"headH":1.02},"c":{"skin":16769228,"hair":1710626,"shirt":2304568,"shirtD":1514534,"pants":1580584,"boot":2764346,"belt":6957610,"gold":6957610,"collar":3029582,"iris":2304562,"sock":null,"apron":null,"skirt":1580584,"hair2":2302766,"hairS":1250072,"skinS":15125176,"shirtS":1909551,"skirtS":1251360,"iris2":1448479},"hair":"hood","eyes":{"w":0.24,"h":0.24},"outfit":"ninja","acc":"visor"},
  "m10": {"k":"m10","n":"道士少年","sx":"男 · 瘦高 · 1.02","g":"m","sk":{"hipY":0.94,"legW":0.26,"torsoH":1,"torsoW":0.9,"torsoD":0.56,"armLen":0.98,"armW":0.23,"headW":1.04,"headH":1},"c":{"skin":16769228,"hair":2763314,"shirt":14210244,"shirtD":12104868,"pants":9079418,"boot":2764346,"belt":6982250,"gold":12626016,"collar":15789280,"iris":2764324,"sock":null,"apron":null,"skirt":9079418,"hair2":3750212,"hairS":1973796,"skinS":15125176,"shirtS":11907749,"skirtS":7237218,"iris2":1711382},"hair":"topknot","eyes":{"w":0.24,"h":0.24},"outfit":"robe"},
  "m11": {"k":"m11","n":"武僧","sx":"男 · 壮实 · 1.04","g":"m","sk":{"hipY":0.88,"legW":0.36,"torsoH":1,"torsoW":1.14,"torsoD":0.72,"armLen":0.98,"armW":0.34,"headW":1.06,"headH":1},"c":{"skin":14198904,"hair":2759188,"shirt":13148240,"shirtD":11042872,"pants":11042872,"boot":2764346,"belt":6965792,"gold":14729328,"collar":14729328,"iris":3024416,"sock":null,"apron":null,"skirt":11042872,"hair2":3744539,"hairS":1970958,"skinS":12752748,"shirtS":11044419,"skirtS":8807981,"iris2":1906708},"hair":"bald","eyes":{"w":0.24,"h":0.24},"outfit":"monk"},
  "m12": {"k":"m12","n":"魔法师","sx":"男 · 瘦高 · 1.02","g":"m","sk":{"hipY":0.94,"legW":0.26,"torsoH":1.02,"torsoW":0.88,"torsoD":0.56,"armLen":1,"armW":0.23,"headW":1.04,"headH":1},"c":{"skin":16769228,"hair":9075376,"shirt":3811930,"shirtD":2628672,"pants":2760768,"boot":2764346,"belt":9071296,"gold":14729312,"collar":12624096,"iris":2761780,"sock":null,"apron":null,"skirt":2760768,"hair2":12232174,"hairS":6510719,"skinS":15125176,"shirtS":3220300,"skirtS":2234931,"iris2":1709600},"hair":"long","eyes":{"w":0.24,"h":0.24},"outfit":"robe"},
  "m13": {"k":"m13","n":"骑士","sx":"男 · 魁梧 · 1.08","g":"m","sk":{"hipY":0.9,"legW":0.38,"torsoH":1.04,"torsoW":1.1,"torsoD":0.72,"armLen":1,"armW":0.34,"headW":1.06,"headH":1},"c":{"skin":16769228,"hair":6969914,"shirt":12108496,"shirtD":9082020,"pants":5923956,"boot":2764346,"belt":3817544,"gold":15782000,"collar":14674164,"iris":2764856,"sock":null,"apron":null,"skirt":5923956,"hair2":9402958,"hairS":4997418,"skinS":15125176,"shirtS":10199983,"skirtS":4739165,"iris2":1711651},"hair":"short","eyes":{"w":0.24,"h":0.24},"outfit":"armorkirt","acc":"cape"},
  "m14": {"k":"m14","n":"弓箭手","sx":"男 · 精瘦 · 1.00","g":"m","sk":{"hipY":0.9,"legW":0.28,"torsoH":0.98,"torsoW":0.92,"torsoD":0.58,"armLen":0.98,"armW":0.24,"headW":1.04,"headH":1},"c":{"skin":16769228,"hair":4864554,"shirt":4876858,"shirtD":3493930,"pants":3818546,"boot":2764346,"belt":6965802,"gold":12623968,"collar":9089136,"iris":2764326,"sock":null,"apron":null,"skirt":3818546,"hair2":6573625,"hairS":3484190,"skinS":15125176,"shirtS":4086065,"skirtS":3028520,"iris2":1711384},"hair":"messy","eyes":{"w":0.24,"h":0.24},"outfit":"plain"},
  "m15": {"k":"m15","n":"机甲少年","sx":"男 · 偏高 · 1.04","g":"m","sk":{"hipY":0.94,"legW":0.34,"torsoH":1.02,"torsoW":1.04,"torsoD":0.66,"armLen":0.98,"armW":0.3,"headW":1.04,"headH":1},"c":{"skin":16769228,"hair":3820122,"shirt":2765372,"shirtD":1975854,"pants":2239026,"boot":2764346,"belt":1712168,"gold":3858656,"collar":3842272,"iris":2241338,"sock":null,"apron":null,"skirt":2239026,"hair2":5137530,"hairS":2766145,"skinS":15125176,"shirtS":2304562,"skirtS":1778216,"iris2":1384484},"hair":"short","eyes":{"w":0.24,"h":0.24},"outfit":"mech","acc":"visor"},
  "m16": {"k":"m16","n":"吸血鬼少年","sx":"男 · 瘦高 · 1.02","g":"m","sk":{"hipY":0.94,"legW":0.26,"torsoH":1,"torsoW":0.88,"torsoD":0.56,"armLen":0.98,"armW":0.23,"headW":1.04,"headH":1},"c":{"skin":15786212,"hair":3482166,"shirt":3810358,"shirtD":2364968,"pants":1708064,"boot":2764346,"belt":6953514,"gold":12595264,"collar":12595264,"iris":3350570,"sock":null,"apron":null,"skirt":1708064,"hair2":4730441,"hairS":2496551,"skinS":14207693,"shirtS":3218989,"skirtS":1379610,"iris2":2102298},"hair":"long","eyes":{"w":0.26,"h":0.26},"outfit":"robe","acc":"batWing"},
  "m17": {"k":"m17","n":"天使少年","sx":"男 · 清瘦 · 1.02","g":"m","sk":{"hipY":0.94,"legW":0.26,"torsoH":1,"torsoW":0.9,"torsoD":0.56,"armLen":0.98,"armW":0.23,"headW":1.04,"headH":1},"c":{"skin":16769228,"hair":15781984,"shirt":16645631,"shirtD":14673138,"pants":16054012,"boot":2764346,"belt":14205024,"gold":16769126,"collar":15781984,"iris":3025440,"sock":null,"apron":null,"skirt":15659772,"hair2":16777090,"hairS":11376197,"skinS":15125176,"shirtS":14013910,"skirtS":12501706,"iris2":1907220},"hair":"short","eyes":{"w":0.26,"h":0.26},"outfit":"robe","acc":"halo"},
  "m18": {"k":"m18","n":"恶魔少年","sx":"男 · 瘦高 · 1.02","g":"m","sk":{"hipY":0.92,"legW":0.28,"torsoH":1,"torsoW":0.92,"torsoD":0.58,"armLen":0.98,"armW":0.24,"headW":1.04,"headH":1},"c":{"skin":16769228,"hair":3809840,"shirt":5121076,"shirtD":3348522,"pants":1970200,"boot":2764346,"belt":6953514,"gold":16734826,"collar":13643856,"iris":3481640,"sock":null,"apron":null,"skirt":1970200,"hair2":5123649,"hairS":2758691,"skinS":15125176,"shirtS":4333100,"skirtS":1576211,"iris2":2167833},"hair":"spiky","eyes":{"w":0.26,"h":0.26},"outfit":"robe","acc":"demonHorn"},
  "m19": {"k":"m19","n":"狼人","sx":"男 · 魁梧 · 1.06","g":"m","sk":{"hipY":0.84,"legW":0.4,"torsoH":1.02,"torsoW":1.18,"torsoD":0.76,"armLen":1.08,"armW":0.36,"headW":1.1,"headH":1.02},"c":{"skin":9075304,"hair":5918792,"shirt":5918792,"shirtD":4537396,"pants":3814444,"boot":2764346,"belt":2761758,"gold":12623968,"collar":6971480,"iris":3354654,"sock":null,"apron":null,"skirt":3814444,"hair2":8023137,"hairS":4274740,"skinS":8154718,"shirtS":4997948,"skirtS":3025443,"iris2":2104851},"hair":"messy","eyes":{"w":0.26,"h":0.26},"outfit":"plain","acc":"gloves"},
  "m20": {"k":"m20","n":"亡灵法师","sx":"男 · 极瘦 · 0.98","g":"m","sk":{"hipY":0.92,"legW":0.22,"torsoH":1,"torsoW":0.82,"torsoD":0.52,"armLen":1,"armW":0.2,"headW":1.04,"headH":1.02},"c":{"skin":14736592,"hair":6978154,"shirt":2763830,"shirtD":1842726,"pants":1711138,"boot":2764346,"belt":5933674,"gold":7004320,"collar":3816004,"iris":2764840,"sock":null,"apron":null,"skirt":1711138,"hair2":9414031,"hairS":5003340,"skinS":13289147,"shirtS":2303277,"skirtS":1381915,"iris2":1711641},"hair":"short","eyes":{"w":0.26,"h":0.26},"outfit":"robe","acc":"blood"}
};
var SKIN_ORDER = ["f01", "f02", "f03", "f04", "f05", "f06", "f07", "f08", "f09", "f10", "f11", "f12", "f13", "f14", "f15", "f16", "f17", "f18", "f19", "f20", "m01", "m02", "m03", "m04", "m05", "m06", "m07", "m08", "m09", "m10", "m11", "m12", "m13", "m14", "m15", "m16", "m17", "m18", "m19", "m20"];
var SKIN_NAME = {"f01": "双马尾剑士", "f02": "巫女", "f03": "女仆", "f04": "精灵射手", "f05": "猫耳少女", "f06": "水手服少女", "f07": "魔法少女", "f08": "吸血鬼萝莉", "f09": "女骑士", "f10": "剑道少女", "f11": "修女", "f12": "机械少女", "f13": "狐仙", "f14": "学生会长", "f15": "拳击少女", "f16": "弓道少女", "f17": "丧尸少女", "f18": "天使", "f19": "恶魔", "f20": "雪女", "m01": "熔岩魔修", "m02": "侏儒炼金师", "m03": "僵尸王", "m04": "赤膊狂战", "m05": "龙裔", "m06": "少年剑士", "m07": "学园不良", "m08": "和风武士", "m09": "忍者", "m10": "道士少年", "m11": "武僧", "m12": "魔法师", "m13": "骑士", "m14": "弓箭手", "m15": "机甲少年", "m16": "吸血鬼少年", "m17": "天使少年", "m18": "恶魔少年", "m19": "狼人", "m20": "亡灵法师"};

/* ★★★ round485：皮肤系统（40 套）★★★
   数据在 core/skin_defs.js（纯数据 ✓）这里只负责"按数据搭模型" ✓
   ★ 关键约定（动画 / 武器 / 血条全都不改）：
       · 返回 { g, armL, armR, legL, legR, sw, swL, h }
       · armL/armR/legL/legR = 四个枢轴 Group，语义和老模型完全一致 ✓
         （手臂枢轴在肩、腿枢轴在髋、脚底在 y=0）
       · sw 挂在右手（handPivot 在手臂末端）✓ 攻击动画只转 sw ✓
       · h = 头顶高度（世界单位，未乘 HERO_SCALE）→ 名字/血条按它抬 ✓ */
/* ★ round510：比例调整开关（1 = 新比例 ✗ 0 = 老比例 ✓ 只给对比图用）*/
var SK_PROP_ADJUST = 1;
var SK_DEF = { hipY: 0.92, legW: 0.24, torsoH: 1.00, torsoW: 0.86, torsoD: 0.54,
               armLen: 0.96, armW: 0.19, armX: 0.56, headW: 1.10, headH: 1.06, headD: 1.02,
               neck: 0.02 };

function skShade(hex, k) {
  var r = (hex >> 16) & 255, g2 = (hex >> 8) & 255, b = hex & 255;
  r = Math.max(0, Math.min(255, Math.round(r * k)));
  g2 = Math.max(0, Math.min(255, Math.round(g2 * k)));
  b = Math.max(0, Math.min(255, Math.round(b * k)));
  return (r << 16) | (g2 << 8) | b;
}

/* 配色派生：高光/阴影各一份（做体积感用） */
function skPal(o) {
  var p = { skin: o.skin || 0xffe0cc, hair: o.hair || 0x2b2b33,
            shirt: o.shirt || 0xffffff, shirtD: o.shirtD || 0xd0d8e0,
            pants: o.pants || 0x2a2e3a, boot: o.boot || 0x2a2e3a,
            belt: o.belt || 0x222630, gold: o.gold || 0xffd166,
            collar: o.collar || 0xffffff, iris: o.iris || 0x3a6ac0,
            sock: o.sock || null, apron: o.apron || null, skirt: o.skirt || null };
  p.hair2 = o.hair2 || skShade(p.hair, 1.35);
  p.hairS = skShade(p.hair, 0.72);
  p.skinS = skShade(p.skin, 0.90);
  p.shirtS = skShade(p.shirt, 0.84);
  p.skirtS = p.skirt ? skShade(p.skirt, 0.80) : null;
  p.iris2 = skShade(p.iris, 0.62);
  return p;
}

function skBox(parent, w, h, d, c, x, y, z, rz) {
  var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matOf(c));
  m.position.set(x || 0, y || 0, z || 0);
  if (rz) { m.rotation.z = rz; }
  m.castShadow = true;
  parent.add(m);
  return m;
}
function skTaper(parent, wTop, wBot, h, c, x, y, z, seg) {
  /* ★ round493（用户："裙子下面那一圈应该改成多边形类似圆，四四方方不好看"）
     · seg = 4 → 四棱台（原来的样子 ✓ 大部分皮肤还用这个）
     · seg = 12~16 → 接近圆的多边形（先只给 f01 双马尾剑士 ✓）
     ★ 半径换算：要保证【对边宽度】= w（不然换成多边形会突然变粗/变细 ✗）
         正 n 边形：对边宽 = 2r·cos(π/n) → r = (w/2)/cos(π/n) ✓
         旋转 π/n 让"平面"正对前方 ✓（和原来 4 段的 π/4 同一个道理 ✓）*/
  var n = Math.max(3, Math.min(24, (seg | 0) || 4));
  var rT = (wTop / 2) / Math.cos(Math.PI / n);
  var rB = (wBot / 2) / Math.cos(Math.PI / n);
  var m = new THREE.Mesh(new THREE.CylinderGeometry(rT, rB, h, n, 1), matOf(c));
  m.rotation.y = Math.PI / n;
  m.position.set(x || 0, y || 0, z || 0);
  m.castShadow = true;
  parent.add(m);
  return m;
}

/* ---------------- 脸：眼睛（男/女各 10 款）+ 嘴巴（10 款） ----------------
   ★ round509（用户："嘴巴和眼睛都做 10 个给我看看，眼睛要分性别"）
   ★ 所有款式都只是【方块】拼的 ✓ 和整个游戏的方块风一致 ✗ 不引入贴图
   ★ 数据驱动：每一款就是一行参数 ✗ 加新款式只加一行 ✓
     字段：w/h 眼白大小 · cut 四角削 · tilt 倾斜 · irW/irH 虹膜 · puW/puH 瞳孔
           hi 高光个数 · hiS 高光大小 · lid 上眼睑粗 · low 下眼睑 · lash 睫毛
           brow 眉毛（0=没有） · browT 眉毛角度 · scar 疤痕（0/1）· y 上下偏移
*/
var EYE_F = [
  /* 1 标准大眼（= round508 之前的样子，一像素不变） */
  { w: 1.00, h: 1.00, cut: 0.32, tilt: 0.00, irW: 0.80, irH: 0.80, puW: 0.30, puH: 0.34,
    hi: 2, hiS: 0.17, lid: 0.13, low: 0.06, lash: 1, brow: 0, browT: 0, scar: 0, y: 0 },
  /* 2 圆眼 */
  { w: 1.06, h: 1.04, cut: 0.42, tilt: 0.00, irW: 0.86, irH: 0.88, puW: 0.26, puH: 0.30,
    hi: 2, hiS: 0.22, lid: 0.11, low: 0.05, lash: 1, brow: 0, browT: 0, scar: 0, y: 0 },
  /* 3 细长（温柔） */
  { w: 1.14, h: 0.72, cut: 0.28, tilt: 0.00, irW: 0.70, irH: 0.74, puW: 0.28, puH: 0.40,
    hi: 1, hiS: 0.18, lid: 0.16, low: 0.05, lash: 1, brow: 0, browT: 0, scar: 0, y: 0 },
  /* 4 猫眼（上挑） */
  { w: 1.10, h: 0.86, cut: 0.26, tilt: 0.13, irW: 0.78, irH: 0.78, puW: 0.28, puH: 0.36,
    hi: 2, hiS: 0.19, lid: 0.15, low: 0.05, lash: 1, brow: 0, browT: 0, scar: 0, y: 0 },
  /* 5 下垂眼（可怜） */
  { w: 1.06, h: 0.90, cut: 0.30, tilt: -0.12, irW: 0.78, irH: 0.80, puW: 0.30, puH: 0.34,
    hi: 2, hiS: 0.20, lid: 0.13, low: 0.07, lash: 1, brow: 0, browT: 0, scar: 0, y: 0 },
  /* 6 半眯（慵懒） */
  { w: 1.10, h: 0.50, cut: 0.24, tilt: 0.02, irW: 0.74, irH: 0.86, puW: 0.30, puH: 0.52,
    hi: 1, hiS: 0.16, lid: 0.20, low: 0.04, lash: 1, brow: 0, browT: 0, scar: 0, y: 0 },
  /* 7 星眼（两点高光 + 大眼） */
  { w: 1.14, h: 1.10, cut: 0.36, tilt: 0.04, irW: 0.90, irH: 0.94, puW: 0.24, puH: 0.26,
    hi: 2, hiS: 0.20, lid: 0.10, low: 0.05, lash: 1, brow: 0, browT: 0, scar: 0, y: 0 },
  /* 8 竖瞳（妖/猫） */
  { w: 1.04, h: 0.96, cut: 0.34, tilt: 0.06, irW: 0.86, irH: 0.92, puW: 0.12, puH: 0.74,
    hi: 1, hiS: 0.18, lid: 0.13, low: 0.05, lash: 1, brow: 0, browT: 0, scar: 0, y: 0 },
  /* 9 细眉细眼（清冷） */
  { w: 1.08, h: 0.64, cut: 0.26, tilt: 0.05, irW: 0.66, irH: 0.66, puW: 0.26, puH: 0.42,
    hi: 1, hiS: 0.14, lid: 0.18, low: 0.05, lash: 1, brow: 0, browT: 0, scar: 0, y: 0.01 },
  /* 10 小豆眼（呆萌） */
  { w: 0.78, h: 0.74, cut: 0.44, tilt: 0.00, irW: 0.92, irH: 0.94, puW: 0.34, puH: 0.36,
    hi: 2, hiS: 0.24, lid: 0.09, low: 0.04, lash: 0, brow: 0, browT: 0, scar: 0, y: 0.02 }
];

var EYE_M = [
  /* 1 窄长眼（round508 默认） */
  { w: 1.08, h: 0.52, cut: 0.20, tilt: 0.00, irW: 0.74, irH: 0.92, puW: 0.30, puH: 0.66,
    hi: 0, hiS: 0.16, lid: 0.11, low: 0.05, lash: 0, brow: 0.052, browT: 0.10, scar: 0, y: 0.06 },
  /* 2 方眼 */
  { w: 0.90, h: 0.76, cut: 0.14, tilt: 0.00, irW: 0.74, irH: 0.88, puW: 0.34, puH: 0.54,
    hi: 0, hiS: 0.16, lid: 0.12, low: 0.05, lash: 0, brow: 0.058, browT: 0.04, scar: 0, y: 0.04 },
  /* 3 上挑凶眼 */
  { w: 1.04, h: 0.48, cut: 0.16, tilt: 0.115, irW: 0.74, irH: 0.96, puW: 0.30, puH: 0.70,
    hi: 0, hiS: 0.16, lid: 0.13, low: 0.05, lash: 0, brow: 0.064, browT: 0.26, scar: 0, y: 0.07 },
  /* 4 小圆眼（少年） */
  { w: 0.80, h: 0.70, cut: 0.34, tilt: 0.00, irW: 0.82, irH: 0.84, puW: 0.34, puH: 0.44,
    hi: 1, hiS: 0.16, lid: 0.10, low: 0.04, lash: 0, brow: 0.048, browT: 0.02, scar: 0, y: 0.05 },
  /* 5 眯眼 */
  { w: 1.00, h: 0.30, cut: 0.22, tilt: 0.02, irW: 0.72, irH: 0.94, puW: 0.30, puH: 0.80,
    hi: 0, hiS: 0.14, lid: 0.14, low: 0.04, lash: 0, brow: 0.068, browT: 0.12, scar: 0, y: 0.07 },
  /* 6 竖瞳（狼/蛇） */
  { w: 1.02, h: 0.62, cut: 0.20, tilt: 0.09, irW: 0.80, irH: 0.92, puW: 0.12, puH: 0.78,
    hi: 0, hiS: 0.14, lid: 0.12, low: 0.05, lash: 0, brow: 0.060, browT: 0.18, scar: 0, y: 0.05 },
  /* 7 三角眼（上平下斜，最凶） */
  { w: 1.02, h: 0.44, cut: 0.10, tilt: 0.16, irW: 0.70, irH: 0.90, puW: 0.32, puH: 0.64,
    hi: 0, hiS: 0.14, lid: 0.17, low: 0.04, lash: 0, brow: 0.070, browT: 0.34, scar: 0, y: 0.08 },
  /* 8 肿眼泡（憨） */
  { w: 0.96, h: 0.64, cut: 0.26, tilt: -0.02, irW: 0.70, irH: 0.80, puW: 0.32, puH: 0.50,
    hi: 0, hiS: 0.14, lid: 0.20, low: 0.08, lash: 0, brow: 0.062, browT: 0.00, scar: 0, y: 0.04 },
  /* 9 单眼皮长眼（东方脸） */
  { w: 1.12, h: 0.46, cut: 0.22, tilt: 0.03, irW: 0.66, irH: 0.88, puW: 0.28, puH: 0.70,
    hi: 0, hiS: 0.14, lid: 0.09, low: 0.06, lash: 0, brow: 0.046, browT: 0.06, scar: 0, y: 0.06 },
  /* 10 疤眼（一道斜疤压在眼上） */
  { w: 1.06, h: 0.56, cut: 0.18, tilt: 0.05, irW: 0.72, irH: 0.92, puW: 0.30, puH: 0.68,
    hi: 0, hiS: 0.14, lid: 0.13, low: 0.05, lash: 0, brow: 0.058, browT: 0.14, scar: 1, y: 0.06 }
];

/* 嘴巴 10 款：w/h 大小 · y 上下 · curve 嘴角上扬(+)下垂(-) · open 张嘴 · teeth 露牙
   lip 唇色 · dark 嘴里暗色 · cross 缝合线（僵尸）· fang 小虎牙 */
var MOUTH = [
  { w: 0.09, h: 0.026, y: -0.30, curve: 0.000, open: 0, teeth: 0, dark: 0, cross: 0, fang: 0 }, // 1 平静
  { w: 0.11, h: 0.026, y: -0.30, curve: 0.022, open: 0, teeth: 0, dark: 0, cross: 0, fang: 0 }, // 2 微笑
  { w: 0.07, h: 0.040, y: -0.30, curve: 0.000, open: 0, teeth: 0, dark: 0, cross: 0, fang: 0 }, // 3 抿嘴
  { w: 0.08, h: 0.055, y: -0.30, curve: 0.000, open: 1, teeth: 0, dark: 1, cross: 0, fang: 0 }, // 4 张嘴
  { w: 0.15, h: 0.030, y: -0.30, curve: 0.034, open: 0, teeth: 0, dark: 0, cross: 0, fang: 0 }, // 5 咧嘴笑
  { w: 0.10, h: 0.026, y: -0.30, curve: 0.030, open: 0, teeth: 0, dark: 0, cross: 0, fang: 0, skew: 1 }, // 6 撇嘴
  { w: 0.10, h: 0.026, y: -0.30, curve: -0.026, open: 0, teeth: 0, dark: 0, cross: 0, fang: 0 }, // 7 八字（苦）
  { w: 0.05, h: 0.046, y: -0.30, curve: 0.000, open: 0, teeth: 0, dark: 0, cross: 0, fang: 0 }, // 8 嘟嘴
  { w: 0.16, h: 0.062, y: -0.31, curve: 0.030, open: 1, teeth: 1, dark: 1, cross: 0, fang: 0 }, // 9 大笑露牙
  { w: 0.12, h: 0.030, y: -0.30, curve: 0.000, open: 0, teeth: 0, dark: 0, cross: 1, fang: 0 }  // 10 缝合嘴
];

function skMouth(headG, S, P, st) {
  st = Math.max(1, Math.min(10, st || 1));
  var m = MOUTH[st - 1];
  var fs = S.faceS || 1;            /* ★ round513：嘴巴尺寸也要跟脸走 ✓ */
  /* ★ 我自己写出来的 bug：批量把 m.w 换成 mw 的时候，把这一行也换成了
     `var mw = mw * fs`（自己乘自己 ✗ undefined → NaN）✗ 嘴巴 4 个盒子全 NaN ✓
     → 表现就是控制台刷 "Computed radius is NaN" ✓ 而且 rAF 链被异常打断 ✗ 自转停了 ✓ */
  var mw = m.w * fs, mh = m.h * fs;
  var hh = S.headH, hd = S.headD;
  var ez = hd * 0.50 + 0.012;
  var y = hh * m.y;
  var lip = 0xcf6b74;
  var dark = 0x5a2a30;
  /* 主体 */
  if (m.open) {
    skBox(headG, mw, mh, 0.026, dark, 0, y, ez);
    skBox(headG, mw * 1.02, 0.014, 0.028, lip, 0, y + mh * 0.52, ez + 0.004);
    skBox(headG, mw * 1.02, 0.014, 0.028, lip, 0, y - mh * 0.52, ez + 0.004);
    if (m.teeth) {
      skBox(headG, mw * 0.84, 0.016, 0.020, 0xf6f2ea, 0, y + mh * 0.30, ez + 0.012);
      skBox(headG, mw * 0.72, 0.012, 0.020, 0xf6f2ea, 0, y - mh * 0.28, ez + 0.012);
    }
  } else {
    skBox(headG, mw, mh, 0.026, lip, 0, y, ez);
    /* 嘴角上扬/下垂：两端各一个小方块，往上或往下挪 */
    var cw = mw * 0.30, ch = mh * 0.86;
    var dy = m.curve;
    var sk = m.skew ? 1 : 0;
    skBox(headG, cw, ch, 0.026, lip, -mw * 0.46, y + (sk ? -dy : dy), ez);
    skBox(headG, cw, ch, 0.026, lip, mw * 0.46, y + dy, ez);
  }
  if (m.fang) {
    skBox(headG, 0.018, 0.024, 0.020, 0xf6f2ea, mw * 0.34, y + mh * 0.35, ez + 0.012);
  }
  if (m.cross) {
    for (var i = -2; i <= 2; i++) {
      skBox(headG, 0.008, 0.030, 0.014, 0x2a2026, i * mw * 0.19, y, ez + 0.016);
    }
  }
  /* 下唇一点点阴影（让嘴有厚度 ✓）*/
  if (!m.open) {
    skBox(headG, mw * 0.9, 0.008, 0.016, 0xa85860, 0, y - mh * 0.9, ez + 0.006);
  }
}

function skEyeDraw(headG, S, P, o, male, E) {
  var hw = S.headW, hh = S.headH, hd = S.headD;
  var ez = hd * 0.50 + 0.012;
  var eyeX = hw * 0.215;
  var _fs = S.faceS || 1;
  var ew = E.w * o.w * _fs, eh = E.h * o.h * _fs;
  var eyeY = hh * 0.02 + hh * (o.y || 0);
  var white = male ? 0xe6e1d8 : 0xffffff;
  var lashC = 0x241f2a;
  var browC = skShade(P.hairS, 0.72);
  var si;

  for (si = -1; si <= 1; si += 2) {
    var bx2 = eyeX * si;
    var rz = -o.tilt * si;

    /* 眼白 */
    skBox(headG, ew, eh, 0.025, white, bx2, eyeY, ez, rz);
    /* 虹膜 */
    skBox(headG, ew * o.irW, eh * o.irH, 0.030, P.iris, bx2, eyeY - eh * 0.04, ez + 0.014, rz);
    skBox(headG, ew * o.irW * 0.78, eh * o.irH * 0.76, 0.032, P.iris2,
          bx2, eyeY - eh * 0.02, ez + 0.019, rz);
    /* 瞳孔 */
    skBox(headG, ew * o.puW, eh * o.puH, 0.034, 0x171219,
          bx2, eyeY - eh * 0.02, ez + 0.026, rz);
    /* 高光（0/1/2/3 个）*/
    if (o.hi >= 1) {
      skBox(headG, ew * o.hiS * (male ? 0.6 : 1), eh * o.hiS, 0.020, 0xffffff,
            bx2 - ew * 0.17, eyeY + eh * 0.18, ez + 0.040, rz);
    }
    if (o.hi >= 2) {
      skBox(headG, ew * o.hiS * 0.5, eh * o.hiS * 0.55, 0.020, 0xffffff,
            bx2 + ew * 0.18, eyeY - eh * 0.22, ez + 0.040, rz);
    }
    /* 上眼睑（睫毛/眼皮）*/
    skBox(headG, ew * 1.04, Math.max(0.014, eh * o.lid), 0.030,
          o.lash ? lashC : skShade(0x1c1620, 1.3),
          bx2, eyeY + eh * 0.52, ez + 0.020, rz);
    /* 下眼睑 */
    skBox(headG, ew * 0.92, Math.max(0.010, eh * o.low), 0.026,
          male ? skShade(P.skinS, 0.92) : skShade(lashC, 1.5),
          bx2, eyeY - eh * 0.54, ez + 0.016, rz);
    /* 女生那两撇上睫毛（形状记忆点 ✓ 男生没有）*/
    if (o.lash) {
      skBox(headG, ew * 0.60, eh * 0.13, 0.045, lashC, bx2 - ew * 0.20, eyeY + eh * 0.50, ez + 0.026);
      skBox(headG, ew * 0.55, eh * 0.13, 0.045, lashC, bx2 + ew * 0.22, eyeY + eh * 0.46, ez + 0.026);
    }
    /* 眉毛（男生才有）*/
    if (o.brow) {
      skBox(headG, E.w * 0.98 * _fs, E.h * o.brow * _fs, 0.030, browC,
            bx2, eyeY + eyecfgBrowY(o, E), ez - 0.002, -o.browT * si);
    }
    /* 疤（斜着压在眼上）*/
    if (o.scar && si < 0) {
      skBox(headG, 0.030 * _fs, E.h * 1.30 * _fs, 0.020, 0xc98a7a, bx2 + ew * 0.10, eyeY + eh * 0.30,
            ez + 0.046, 0.42);
    }
    /* 四角削圆 */
    var cw2 = ew * o.cut, ch2 = eh * o.cut;
    for (var ti = -1; ti <= 1; ti += 2) {
      skBox(headG, cw2, ch2, 0.02, P.skin,
            si * (eyeX + ew / 2 - cw2 / 2),
            eyeY + ti * (eh / 2 - ch2 / 2),
            ez + 0.052);
    }
  }
  /* 鼻子 */
  skBox(headG, 0.05 * _fs, 0.05 * _fs, 0.03, P.skinS, 0, eyeY - eh * 1.35, ez + 0.002);
}
function eyecfgBrowY(o, E) {
  return E.h * (0.80 + (o.browT > 0.2 ? -0.10 : 0));
}

/* 女生：10 款 */
function skFace(headG, S, P, E, st) {
  st = Math.max(1, Math.min(10, st || 1));
  skEyeDraw(headG, S, P, EYE_F[st - 1], false, E);
  skBox(headG, 0.09, 0.032, 0.026, 0xcf6b74, 0, 0, 0);   /* 占位（旧腮红的坐标算在下面）*/
  skMouth(headG, S, P, (E && E.mo) || 1);
  if (E && E.blush) {
    var hw = S.headW, hh = S.headH;
    skBox(headG, 0.17, 0.06, 0.02, 0xf2a8ac, -hw * 0.33, -hh * 0.15, S.headD * 0.5 + 0.006);
    skBox(headG, 0.17, 0.06, 0.02, 0xf2a8ac, hw * 0.33, -hh * 0.15, S.headD * 0.5 + 0.006);
  }
}

/* 男生：10 款 */
function skFaceM(headG, S, P, E, st) {
  st = Math.max(1, Math.min(10, st || 1));
  skEyeDraw(headG, S, P, EYE_M[st - 1], true, E);
  skMouth(headG, S, P, (E && E.mo) || 1);
}

/* ---------------- 头发 ---------------- */
function skHair(headG, S, P, style, pinColor) {
  var hc = P.hair, hi = P.hair2, hs = P.hairS;
  var hw = S.headW, hh = S.headH, hd = S.headD;
  var q, sx2, tl;

  function cap() {
    skBox(headG, hw * 1.06, 0.30, hd * 1.06, hc, 0, hh * 0.50, 0);
    skBox(headG, hw * 0.92, 0.10, hd * 0.92, hi, 0, hh * 0.60, 0);
    skBox(headG, hw * 1.02, 0.12, 0.10, hc, 0, hh * 0.36, hd * 0.47);
    skBox(headG, hw * 1.06, hh * 0.64, hd * 0.34, hc, 0, hh * 0.16, -hd * 0.48);
    skBox(headG, hw * 1.06, hh * 0.40, hd * 0.30, hs, 0, hh * 0.02, -hd * 0.50);
    skBox(headG, hw * 0.11, hh * 0.72, hd * 1.02, hc, -hw * 0.505, hh * 0.18, 0);
    skBox(headG, hw * 0.11, hh * 0.72, hd * 1.02, hc, hw * 0.505, hh * 0.18, 0);
  }
  function bangs() {
    skBox(headG, hw * 0.98, 0.30, 0.08, hc, 0, hh * 0.32, hd * 0.50);
    skBox(headG, hw * 0.20, 0.14, 0.08, hi, 0, hh * 0.44, hd * 0.50);
    skBox(headG, hw * 0.19, 0.34, 0.08, hc, -hw * 0.39, hh * 0.27, hd * 0.50);
    skBox(headG, hw * 0.19, 0.34, 0.08, hc, hw * 0.39, hh * 0.27, hd * 0.50);
    skBox(headG, hw * 0.13, 0.12, 0.078, hs, -hw * 0.20, hh * 0.17, hd * 0.505);
    skBox(headG, hw * 0.11, 0.10, 0.078, hs, hw * 0.13, hh * 0.18, hd * 0.505);
  }
  function sidelocks(len) {
    skBox(headG, 0.085, len, hd * 0.40, hc, -hw * 0.50, -len / 2 + hh * 0.20, hd * 0.24);
    skBox(headG, 0.085, len, hd * 0.40, hc, hw * 0.50, -len / 2 + hh * 0.20, hd * 0.24);
    skBox(headG, 0.085, 0.10, hd * 0.40, hs, -hw * 0.50, -len + hh * 0.20, hd * 0.24);
    skBox(headG, 0.085, 0.10, hd * 0.40, hs, hw * 0.50, -len + hh * 0.20, hd * 0.24);
  }
  function back(len, c) {
    skBox(headG, hw * 1.00, len, hd * 0.40, c || hc, 0, -len / 2 + hh * 0.30, -hd * 0.44);
    skBox(headG, hw * 0.96, len * 0.16, hd * 0.42, hs, 0, -len + hh * 0.30 + len * 0.06, -hd * 0.44);
  }

  if (style === 'spiky') {
    cap();
    for (q = -2; q <= 2; q++) {
      skBox(headG, 0.14, 0.26, 0.14, hc, q * hw * 0.20, hh * 0.62, hd * 0.10, q * 0.22);
      skBox(headG, 0.12, 0.20, 0.12, hc, q * hw * 0.22, hh * 0.58, -hd * 0.22, q * -0.18);
    }
    bangs();
  } else if (style === 'messy') {
    cap(); bangs();
    skBox(headG, hw * 0.22, 0.18, hw * 0.22, hc, -hw * 0.34, hh * 0.62, hd * 0.02, 0.20);
    skBox(headG, hw * 0.18, 0.22, hw * 0.18, hc, hw * 0.30, hh * 0.66, -hd * 0.06, -0.24);
    skBox(headG, hw * 0.14, 0.16, hw * 0.14, hs, hw * 0.06, hh * 0.70, hd * 0.12, 0.5);
    sidelocks(0.34);
  } else if (style === 'topknot') {
    cap(); bangs(); sidelocks(0.30);
    skBox(headG, 0.16, 0.14, 0.16, hc, 0, hh * 0.66, -hd * 0.04);
    skBox(headG, 0.20, 0.16, 0.20, hc, 0, hh * 0.76, -hd * 0.06);
    skBox(headG, 0.18, 0.05, 0.18, hs, 0, hh * 0.70, -hd * 0.06);
  } else if (style === 'short') {
    cap(); bangs(); sidelocks(0.30);
  } else if (style === 'bob') {
    cap(); bangs(); sidelocks(0.54); back(0.58);
  } else if (style === 'long') {
    cap(); bangs(); sidelocks(0.78); back(1.55);
  } else if (style === 'hime') {
    cap(); bangs(); sidelocks(0.64); back(1.45);
    skBox(headG, hw * 1.02, 0.16, hd * 0.94, hc, 0, hh * 0.30, -hd * 0.16);
    skBox(headG, hw * 1.02, 0.05, hd * 0.94, hs, 0, hh * 0.22, -hd * 0.16);
  } else if (style === 'twintail') {
    cap(); bangs(); sidelocks(0.36);
    tl = 0.92;
    for (sx2 = -1; sx2 <= 1; sx2 += 2) {
      skBox(headG, 0.20, 0.18, 0.20, hc, hw * 0.56 * sx2, hh * 0.42, -hd * 0.04);
      skBox(headG, 0.23, 0.07, 0.23, pinColor || hi, hw * 0.58 * sx2, hh * 0.36, -hd * 0.04);
      skBox(headG, 0.18, tl * 0.62, 0.18, hc, hw * 0.62 * sx2, hh * 0.32 - tl * 0.30, -hd * 0.08);
      skBox(headG, 0.16, tl * 0.44, 0.16, hc, hw * 0.63 * sx2, hh * 0.32 - tl * 0.74, -hd * 0.10);
      skBox(headG, 0.15, 0.10, 0.15, hs, hw * 0.63 * sx2, hh * 0.32 - tl * 0.95, -hd * 0.10);
    }
  } else if (style === 'ponytail') {
    cap(); bangs(); sidelocks(0.42);
    skBox(headG, 0.22, 0.18, 0.22, hc, 0, hh * 0.48, -hd * 0.54);
    skBox(headG, 0.26, 0.07, 0.26, pinColor || hi, 0, hh * 0.42, -hd * 0.54);
    skBox(headG, 0.20, 0.70, 0.20, hc, 0, hh * 0.36 - 0.36, -hd * 0.62);
    skBox(headG, 0.17, 0.52, 0.17, hc, 0, hh * 0.36 - 0.92, -hd * 0.66);
    skBox(headG, 0.15, 0.10, 0.15, hs, 0, hh * 0.36 - 1.20, -hd * 0.66);
  } else if (style === 'veil') {
    skBox(headG, hw * 1.14, 0.30, hd * 1.14, 0xffffff, 0, hh * 0.52, 0);
    skBox(headG, hw * 1.14, hh * 0.92, 0.14, 0xffffff, 0, -hh * 0.10, -hd * 0.56);
    skBox(headG, 0.13, hh * 0.92, hd * 0.94, 0xffffff, -hw * 0.58, -hh * 0.10, 0);
    skBox(headG, 0.13, hh * 0.92, hd * 0.94, 0xffffff, hw * 0.58, -hh * 0.10, 0);
    skBox(headG, hw * 1.10, 0.05, 0.15, 0xd8dce6, 0, hh * 0.36, -hd * 0.56);
  } else if (style === 'hood') {
    skBox(headG, hw * 1.16, hh * 0.46, hd * 1.16, hc, 0, hh * 0.46, 0);
    skBox(headG, 0.20, hh * 0.62, hd * 0.96, hc, -hw * 0.56, hh * 0.10, 0);
    skBox(headG, 0.20, hh * 0.62, hd * 0.96, hc, hw * 0.56, hh * 0.10, 0);
    bangs();
  }

  if (pinColor) {
    var px2 = hw * 0.36, py2 = hh * 0.46, pz2 = hd * 0.30;
    skBox(headG, 0.20, 0.10, 0.10, pinColor, px2, py2, pz2);
    skBox(headG, 0.10, 0.14, 0.10, pinColor, px2 - 0.13, py2 + 0.02, pz2);
    skBox(headG, 0.10, 0.14, 0.10, pinColor, px2 + 0.13, py2 + 0.02, pz2);
  }
  if (style === 'twintail' || style === 'bob' || style === 'hime' || style === 'veil' || style === 'short') {
    skBox(headG, 0.07, 0.18, 0.07, hc, hw * 0.06, hh * 0.60, hd * 0.10, 0.42);
    skBox(headG, 0.05, 0.10, 0.05, hc, hw * 0.13, hh * 0.70, hd * 0.10, 0.75);
  }
}

/* ---------------- 服装 ---------------- */
function skOutfit(g, S, P, ch, hipY, torsoTop) {
  var kind = ch.outfit || 'plain';
  var skirt = ch.skirt;
  var i2, vl;

  if (kind === 'sailor') {
    skBox(g, S.torsoW * 0.96, 0.14, S.torsoD * 1.06, P.collar, 0, torsoTop - 0.01, 0);
    skBox(g, S.torsoW * 0.90, 0.26, S.torsoD * 0.26, P.collar, 0, torsoTop - 0.20, -S.torsoD * 0.44);
    skBox(g, S.torsoW * 0.84, 0.04, S.torsoD * 0.26, 0xffffff, 0, torsoTop - 0.27, -S.torsoD * 0.46);
    vl = S.torsoH * 0.30;
    skBox(g, S.torsoW * 0.17, vl, 0.06, P.collar, -S.torsoW * 0.19, torsoTop - 0.16 - vl / 2, S.torsoD * 0.50, 0.42);
    skBox(g, S.torsoW * 0.17, vl, 0.06, P.collar, S.torsoW * 0.19, torsoTop - 0.16 - vl / 2, S.torsoD * 0.50, -0.42);
    skBox(g, 0.15, 0.10, 0.09, P.gold, 0, torsoTop - 0.30, S.torsoD * 0.52);
  } else if (kind === 'maid') {
    skBox(g, S.torsoW * 0.94, 0.14, S.torsoD * 1.05, P.apron, 0, torsoTop - 0.02, 0);
    skBox(g, S.torsoW * 0.56, S.torsoH * 0.48, 0.05, P.apron, 0, hipY + S.torsoH * 0.42, S.torsoD * 0.55);
    skBox(g, S.torsoW * 0.62, 0.10, S.torsoD * 0.64, P.apron, 0, hipY + 0.24, 0);
    skBox(g, 0.10, 0.10, 0.10, P.gold, 0, hipY + 0.36, S.torsoD * 0.56);
    for (i2 = -2; i2 <= 2; i2++) {
      skBox(g, 0.22, 0.10, 0.22, P.apron, i2 * 0.26,
            hipY - (skirt ? skirt.len : 0.6) + 0.34, S.torsoD * 0.40);
    }
  } else if (kind === 'miko') {
    skBox(g, S.torsoW * 0.92, 0.18, S.torsoD * 1.05, P.collar, 0, torsoTop - 0.04, 0);
    skBox(g, 0.86, 0.10, 0.10, P.gold, 0, torsoTop - 0.22, S.torsoD * 0.50);
    skBox(g, 0.30, 0.24, 0.05, P.gold, 0, torsoTop - 0.40, S.torsoD * 0.53);
  } else if (kind === 'nun') {
    skBox(g, 0.13, 0.34, 0.05, P.gold, 0, torsoTop - 0.34, S.torsoD * 0.55);
    skBox(g, 0.34, 0.13, 0.05, P.gold, 0, torsoTop - 0.26, S.torsoD * 0.55);
  } else if (kind === 'mech') {
    skBox(g, S.torsoW * 1.06, 0.22, S.torsoD * 1.08, P.shirtD, 0, torsoTop - 0.10, 0);
    skBox(g, 0.16, 0.16, 0.08, P.collar, -S.torsoW * 0.26, torsoTop - 0.32, S.torsoD * 0.54);
    skBox(g, 0.09, 0.55, 0.09, P.gold, S.torsoW * 0.50, hipY + 0.26, -S.torsoD * 0.36);
    skBox(g, S.torsoW * 0.30, 0.10, 0.10, P.collar, 0, hipY + 0.06, S.torsoD * 0.54);
  } else if (kind === 'armorkirt') {
    skBox(g, S.torsoW * 1.10, 0.32, S.torsoD * 1.08, P.shirtD, 0, torsoTop - 0.16, 0);
    skBox(g, S.torsoW * 1.10, 0.05, S.torsoD * 1.10, P.gold, 0, torsoTop - 0.33, 0);
    skBox(g, 0.46, 0.18, 0.52, P.shirtD, -S.armX, torsoTop - 0.06, 0);
    skBox(g, 0.46, 0.18, 0.52, P.shirtD, S.armX, torsoTop - 0.06, 0);
    skBox(g, 0.14, 0.14, 0.14, P.gold, 0, torsoTop - 0.05, S.torsoD * 0.52);
  } else if (kind === 'sport' || kind === 'hoodie') {
    skBox(g, S.torsoW * 0.94, 0.18, S.torsoD * 1.06, P.collar, 0, torsoTop - 0.04, 0);
    skBox(g, 0.30, 0.10, S.torsoD * 0.98, P.collar, 0, torsoTop - 0.14, 0);
  } else if (kind === 'frill' || kind === 'dress') {
    skBox(g, S.torsoW * 0.96, 0.16, S.torsoD * 1.06, P.collar, 0, torsoTop - 0.02, 0);
    skBox(g, S.torsoW * 0.34, 0.14, 0.06, P.gold, 0, torsoTop - 0.18, S.torsoD * 0.52);
    skBox(g, S.torsoW * 0.20, 0.10, 0.06, P.gold, 0, torsoTop - 0.10, S.torsoD * 0.52);
  } else if (kind === 'hanfu') {
    skBox(g, S.torsoW * 0.96, 0.18, S.torsoD * 1.05, P.collar, 0, torsoTop - 0.03, 0);
    skBox(g, 0.10, S.torsoH * 0.5, 0.06, P.collar, -S.torsoW * 0.20, hipY + S.torsoH * 0.45, S.torsoD * 0.52);
    skBox(g, 0.10, S.torsoH * 0.5, 0.06, P.collar, S.torsoW * 0.20, hipY + S.torsoH * 0.45, S.torsoD * 0.52);
    skBox(g, S.torsoW * 0.30, 0.14, 0.06, P.gold, 0, hipY + 0.16, S.torsoD * 0.54);
  } else if (kind === 'kendo') {
    skBox(g, S.torsoW * 0.94, 0.16, S.torsoD * 1.05, P.collar, 0, torsoTop - 0.02, 0);
    skBox(g, S.torsoW * 0.16, 0.46, 0.08, P.collar, -S.torsoW * 0.24, torsoTop - 0.30, S.torsoD * 0.50);
    skBox(g, S.torsoW * 0.16, 0.46, 0.08, P.collar, S.torsoW * 0.24, torsoTop - 0.30, S.torsoD * 0.50);
  } else if (kind === 'ninja') {
    skBox(g, S.torsoW * 1.02, 0.34, S.torsoD * 1.06, P.collar, 0, torsoTop - 0.16, 0);
    skBox(g, 0.10, S.torsoH * 0.5, 0.06, P.collar, 0, hipY + S.torsoH * 0.45, S.torsoD * 0.52);
    skBox(g, S.torsoW * 1.04, 0.10, S.torsoD * 1.08, P.belt, 0, hipY + 0.22, 0);
  } else if (kind === 'robe') {
    skBox(g, S.torsoW * 0.98, 0.16, S.torsoD * 1.05, P.collar, 0, torsoTop - 0.02, 0);
    skBox(g, 0.09, S.torsoH * 0.62, 0.06, skShade(P.shirt, 0.78), 0, hipY + S.torsoH * 0.5, S.torsoD * 0.52);
    skBox(g, S.torsoW * 1.06, 0.10, S.torsoD * 1.06, P.belt, 0, hipY + 0.20, 0);
    skBox(g, 0.24, 0.16, 0.10, P.gold, 0, hipY + 0.20, S.torsoD * 0.54);
  } else if (kind === 'monk') {
    skBox(g, S.torsoW * 0.96, 0.16, S.torsoD * 1.06, P.collar, 0, torsoTop - 0.03, 0);
    skBox(g, 0.90, 0.10, 0.10, P.gold, 0, torsoTop - 0.26, S.torsoD * 0.50);
    skBox(g, 0.14, 0.14, 0.14, P.gold, 0, torsoTop - 0.40, S.torsoD * 0.52);
  }

  if (skirt) {
    var hl = skirt.len;
    var sTop = Math.min(skirt.top, S.torsoW * 0.80);
    var sBot = Math.max(skirt.bot, sTop + 0.18);
    /* ★ round495（用户："可以把裙子都按照这样改一下"）
       · 有写 seg 就按写的 ✓（f01 = 8，用户确认过 ✓）
       · 没写就按【裙长】自动挑：
           短裙 < 0.55      → 8 边形
           及膝 0.55~0.85   → 10 边形
           长袍 ≥ 0.85      → 12 边形（更长更柔和，不然八角太硬 ✓）*/
    var sSeg = (skirt.seg | 0) ||
               (skirt.len >= 0.85 ? 12 : (skirt.len >= 0.55 ? 10 : 8));
    skTaper(g, sTop, sBot, hl, P.skirt || P.shirt, 0, hipY - hl / 2 + 0.26, 0, sSeg);
    var sc2 = P.skirt || P.shirt;
    /* ★ round493：多边形裙（seg>4）靠自己的斜面就有明暗 ✓
       再贴平板会【露在裙外面】或者被吃进里面 ✗ 所以只给 4 段的贴 ✓ */
    if (sSeg <= 4) {
      skBox(g, sBot * 0.28, hl * 0.78, 0.04, skShade(sc2, 0.78), -sBot * 0.30, hipY - hl / 2 + 0.28, sBot * 0.30);
      skBox(g, sBot * 0.28, hl * 0.78, 0.04, skShade(sc2, 0.78), sBot * 0.30, hipY - hl / 2 + 0.28, sBot * 0.30);
      skBox(g, sBot * 0.15, hl * 0.72, 0.04, skShade(sc2, 1.18), 0, hipY - hl / 2 + 0.30, sBot * 0.34);
    }
    skTaper(g, sBot * 0.99, sBot * 1.03, 0.07, skShade(sc2, 1.25), 0, hipY - hl + 0.30, 0, sSeg);
    skBox(g, sBot * 0.7, 0.04, sBot * 0.7, P.skirtS || P.shirtS, 0, hipY - hl + 0.30, 0);
  }
}

/* ---------------- 配件 ---------------- */
function skAcc(g, headG, armL, armR, S, P, kind, backG, hipY, torsoTop) {
  if (!kind) { return; }
  var hw = S.headW, hh = S.headH, hd = S.headD, s2, gc, lc, lc2, ring;
  if (kind === 'catEar') {
    for (s2 = -1; s2 <= 1; s2 += 2) {
      skBox(headG, 0.24, 0.28, 0.18, P.hair, hw * 0.34 * s2, hh * 0.72, 0.02);
      skBox(headG, 0.12, 0.14, 0.08, 0xf0a0b0, hw * 0.34 * s2, hh * 0.70, 0.10);
    }
  } else if (kind === 'foxEar') {
    for (s2 = -1; s2 <= 1; s2 += 2) {
      skBox(headG, 0.20, 0.38, 0.15, P.hair, hw * 0.33 * s2, hh * 0.80, 0.0);
      skBox(headG, 0.10, 0.20, 0.09, 0xf6d8e6, hw * 0.33 * s2, hh * 0.78, 0.05);
    }
  } else if (kind === 'elfEar') {
    skBox(headG, 0.09, 0.28, 0.09, P.skin, -hw * 0.56, hh * 0.10, -0.02, 0.38);
    skBox(headG, 0.09, 0.28, 0.09, P.skin, hw * 0.56, hh * 0.10, -0.02, -0.38);
  } else if (kind === 'demonHorn') {
    for (s2 = -1; s2 <= 1; s2 += 2) {
      skBox(headG, 0.13, 0.30, 0.13, 0xd03050, hw * 0.33 * s2, hh * 0.76, 0.02, 0.28 * s2);
      skBox(headG, 0.09, 0.24, 0.09, 0xb02040, hw * 0.40 * s2, hh * 0.94, 0.02, 0.5 * s2);
    }
  } else if (kind === 'halo') {
    ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.04, 8, 22), matOf(0xffe066));
    ring.position.set(0, hh * 0.96, -0.06);
    ring.rotation.x = Math.PI / 2;
    headG.add(ring);
  } else if (kind === 'visor') {
    skBox(headG, hw * 0.96, 0.13, 0.06, 0x0ae0e0, 0, hh * 0.05, hw * 0.52);
    skBox(headG, 0.16, 0.07, 0.06, 0xff2fa0, -hw * 0.52, hh * 0.05, 0.02);
  } else if (kind === 'glasses') {
    skBox(headG, 0.22, 0.15, 0.03, 0x2a3038, -hw * 0.215, hh * 0.02, hd * 0.54);
    skBox(headG, 0.22, 0.15, 0.03, 0x2a3038, hw * 0.215, hh * 0.02, hd * 0.54);
    skBox(headG, 0.10, 0.03, 0.03, 0x2a3038, 0, hh * 0.03, hd * 0.54);
  } else if (kind === 'goggles') {
    skBox(headG, hw * 1.06, 0.10, hd * 1.04, 0x2a2a30, 0, hh * 0.30, hd * 0.06);
    skBox(headG, 0.22, 0.18, 0.06, 0x1e2a34, -hw * 0.22, hh * 0.30, hd * 0.52);
    skBox(headG, 0.22, 0.18, 0.06, 0x1e2a34, hw * 0.22, hh * 0.30, hd * 0.52);
    skBox(headG, 0.17, 0.13, 0.07, 0x8ae0ff, -hw * 0.22, hh * 0.30, hd * 0.545);
    skBox(headG, 0.17, 0.13, 0.07, 0x8ae0ff, hw * 0.22, hh * 0.30, hd * 0.545);
  } else if (kind === 'headband') {
    skBox(headG, hw * 1.06, 0.11, hd * 1.06, 0xffffff, 0, hh * 0.40, 0);
    skBox(headG, 0.14, 0.16, 0.10, 0xffffff, hw * 0.30, hh * 0.34, -hd * 0.30);
  } else if (kind === 'ribbon') {
    skBox(headG, 0.46, 0.14, 0.10, 0xd8342c, 0, hh * 0.54, -hd * 0.28);
    skBox(headG, 0.14, 0.12, 0.10, 0xd8342c, -0.22, hh * 0.58, -hd * 0.28);
    skBox(headG, 0.14, 0.12, 0.10, 0xd8342c, 0.22, hh * 0.58, -hd * 0.28);
  } else if (kind === 'gloves') {
    gc = P.belt || 0xd8342c;
    skBox(armL, S.armW * 1.45, 0.24, S.armW * 1.45, gc, 0, -S.armLen + 0.14, 0);
    skBox(armR, S.armW * 1.45, 0.24, S.armW * 1.45, gc, 0, -S.armLen + 0.14, 0);
  } else if (kind === 'cape') {
    skBox(backG, S.torsoW * 1.18, 1.10, 0.09, 0x8a2a3a, 0, -0.34, -0.05);
    skBox(backG, S.torsoW * 1.18, 0.09, 0.10, 0xf0d070, 0, 0.18, -0.05);
  } else if (kind === 'batWing') {
    for (s2 = -1; s2 <= 1; s2 += 2) {
      skBox(backG, 0.26, 0.44, 0.07, 0x2a1a2a, 0.34 * s2, 0.16, -0.05, 0.3 * s2);
      skBox(backG, 0.22, 0.34, 0.07, 0x2a1a2a, 0.56 * s2, -0.02, -0.05, 0.2 * s2);
    }
  } else if (kind === 'blood') {
    skBox(headG, 0.09, 0.30, 0.03, 0x8a1a1a, -hw * 0.30, -hh * 0.26, hd * 0.52);
    skBox(g, 0.12, 0.46, 0.03, 0x8a1a1a, S.torsoW * 0.18, hipY + S.torsoH * 0.30, S.torsoD * 0.55);
  } else if (kind === 'snow') {
    skBox(headG, 0.09, 0.09, 0.09, 0xffffff, hw * 0.42, hh * 0.36, 0.10);
    skBox(headG, 0.05, 0.05, 0.05, 0xffffff, hw * 0.54, hh * 0.22, 0.06);
  } else if (kind === 'lava') {
    lc = 0xff7a20; lc2 = 0xffc050;
    for (s2 = -1; s2 <= 1; s2 += 2) {
      skBox(headG, 0.13, 0.30, 0.13, 0xd03050, hw * 0.33 * s2, hh * 0.76, 0.02, 0.28 * s2);
      skBox(headG, 0.09, 0.24, 0.09, 0xb02040, hw * 0.40 * s2, hh * 0.94, 0.02, 0.5 * s2);
    }
    skBox(g, 0.05, S.torsoH * 0.55, 0.04, lc, -S.torsoW * 0.18, hipY + S.torsoH * 0.45, S.torsoD * 0.52);
    skBox(g, 0.04, S.torsoH * 0.30, 0.04, lc2, S.torsoW * 0.10, hipY + S.torsoH * 0.62, S.torsoD * 0.52);
    skBox(g, 0.16, 0.05, 0.04, lc, S.torsoW * 0.02, hipY + S.torsoH * 0.30, S.torsoD * 0.52);
  }
}

/* ---------------- 按皮肤 key 搭一个人 ---------------- */
function skBuildHero(key, custom) {
  var def = (typeof SKIN_DEFS !== 'undefined') ? SKIN_DEFS[key] : null;
  if (!def) { return null; }
  var g = new THREE.Group();
  var S = {}, k;
  for (k in SK_DEF) { S[k] = SK_DEF[k]; }
  for (k in (def.sk || {})) { S[k] = def.sk[k]; }
  /* ★★★ round510（用户："女生的头再改小一点点，男的腿也跟着一样加长"）★★★
     ★ 全部在这里做比例调整 ✗ 不去改 40 份皮肤数据 ✓
       （以后想再调，就改这一块的 4 个数字 ✓ 一处生效 ✓）
     ★ 铁律：**总高不能变**（头顶称号/血条/相机都按 h 算 ✓）
         h = hipY + torsoH + neck + 0.05 + headH
         所以每加长腿 0.12 就必须缩短上身 0.12 ✓ 一加一减抵消 ✓
     ★ 女生额外：头 ×0.94 ✗ 头小了总高会矮 0.06 ✗ 用腿 +0.12 / 上身 -0.06 补回来 ✓
       （顺手也多了一点腿长 ✓ 正好是想要的效果）*/
  /* ★ 对比图/调试时要能关掉（tools/preview_before_after.html 用 ✓）*/
  if (typeof SK_PROP_ADJUST === 'undefined' || SK_PROP_ADJUST) {
    /* ★ round511（用户："女生的头改到 0.8，男生的头改到 0.9"）
       ★ 头变小 → 总高会矮 ✗ 所以【把变矮的那部分补给腿】✓
         h = hipY + torsoH + neck + 0.05 + headH
         头矮了 dh → 腿长 dh ✓ 一加一抵 ✓ 头顶高度不变 ✓
       ★ 另外【腿至少再加 0.12】（上一轮定的长腿 ✓）
         所以：腿加 max(0.12, dh) ✗ 上身相应减 (加的 - dh) ✓ 总高还是不变 ✓ */
    var _hs = (def.g === 'f') ? 0.80 : 0.90;
    var _h0 = S.headH;
    /* ★ round512（用户："你只是把头变窄了，厚度没有跟着调整"）
       → 宽/高/深【三个方向一起缩】✗ 不然脑袋就成了薄板 ✓ */
    S.headW *= _hs; S.headH *= _hs; S.headD *= _hs;
    var _dh = _h0 - S.headH;
    var _dLeg = Math.max(0.12, _dh);
    S.hipY += _dLeg;
    S.torsoH -= (_dLeg - _dh);
    /* ★ round514（用户："头的高可以加一点点，加 0.05"）
       ★ 只加【高】不加宽/深（脸型稍微拉长一点 ✓）
       ★ 加高会让总高 +0.05 ✗ 所以腿减 0.05 抵回来 ✓ 头顶还是同一个高度 ✓ */
    S.headH += 0.05;
    S.hipY -= 0.05;
  }
  /* ★★ round513（用户："眼睛和嘴巴是不是应该也要跟着缩小才对"）
     ★ 对 ✗ 眼睛/嘴巴的【尺寸】原来是写死的（def.eyes 里的 0.26/0.30）✗
       头缩小以后只有"位置"跟着走（eyeX/ez 是按 headW/headD 算的 ✓）
       → 五官在缩小后的脸上就显得【偏大】✓✓ 一眼看出不对 ✓
     ★ 现在给一个 faceS（脸的比例）✗ 眼睛/嘴巴/鼻子 全部乘它 ✓
       faceS = 当前头宽 / 默认头宽（默认 1.10 ✓ 已经把性别缩放算进去了）*/
  S.faceS = (typeof SK_PROP_ADJUST === 'undefined' || SK_PROP_ADJUST) ? (S.headW / 1.10) : 1;
  S.armX = S.torsoW * 0.5 + S.armW * 0.55;
  var P = skPal(def.c);
  /* ★★ round510：皮肤自定义（捏脸/染色）★★
     custom = { ey:0..9, mo:0..9, iris:0x.., hair:0x.., shirt:0x.. } ✗ 没传就是原样 ✓
     ★ 颜色改了要【把派生色一起重算】✗ 不然暗部/亮部还是原来的颜色 ✓（会脏） */
  var _cus = (custom && typeof custom === 'object') ? custom : null;
  if (_cus) {
    if (typeof _cus.iris === 'number') { P.iris = _cus.iris; P.iris2 = skShade(P.iris, 0.62); }
    if (typeof _cus.hair === 'number') {
      P.hair = _cus.hair;
      P.hair2 = skShade(P.hair, 1.35);
      P.hairS = skShade(P.hair, 0.72);
    }
    if (typeof _cus.shirt === 'number') {
      P.shirt = _cus.shirt;
      P.shirtD = skShade(P.shirt, 0.78);
      P.shirtS = skShade(P.shirt, 0.84);
    }
    /* ★ round519（用户："下半身的颜色没办法改，例如裙子"）
       → 裙子和裤子也能单独染色 ✓（没裙子的皮肤改了也不显示，不影响 ✓）*/
    if (typeof _cus.skirt === 'number') {
      P.skirt = _cus.skirt;
      P.skirtS = skShade(P.skirt, 0.80);
    }
    if (typeof _cus.pants === 'number') { P.pants = _cus.pants; }
  }

  var hipY = S.hipY;
  var torsoTop = hipY + S.torsoH;
  var shoulderY = torsoTop - 0.06;
  var headY = torsoTop + S.neck + S.headH / 2 + 0.05;
  var handY = -(S.armLen + 0.03);

  var legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-S.legW * 0.72, hipY, 0);
  legR.position.set(S.legW * 0.72, hipY, 0);
  g.add(legL); g.add(legR);
  [legL, legR].forEach(function (lg) {
    skBox(lg, S.legW, hipY * 0.52, S.legW, P.pants, 0, -hipY * 0.26, 0);
    skBox(lg, S.legW * 0.92, hipY * 0.46, S.legW * 0.92, P.sock || P.pants, 0, -hipY * 0.73, 0);
    if (P.sock) {
      skBox(lg, S.legW * 1.02, 0.07, S.legW * 1.02, skShade(P.sock, 1.1), 0, -hipY * 0.50, 0);
    }
    skBox(lg, S.legW * 1.10, 0.16, S.legW * 1.34, P.boot, 0, -hipY + 0.09, 0.03);
    skBox(lg, S.legW * 1.16, 0.05, S.legW * 1.40, skShade(P.boot, 0.7), 0, -hipY + 0.01, 0.03);
  });

  skBox(g, S.torsoW, S.torsoH * 0.56, S.torsoD, P.shirt, 0, torsoTop - S.torsoH * 0.28, 0);
  skBox(g, S.torsoW * 0.84, S.torsoH * 0.30, S.torsoD * 0.92, P.shirt, 0, hipY + S.torsoH * 0.35, 0);
  skBox(g, S.torsoW * 0.95, S.torsoH * 0.22, S.torsoD * 0.98, P.shirt, 0, hipY + S.torsoH * 0.12, 0);
  skBox(g, 0.04, S.torsoH * 0.54, S.torsoD * 0.9, P.shirtS, -S.torsoW * 0.49, torsoTop - S.torsoH * 0.28, 0);
  skBox(g, 0.04, S.torsoH * 0.54, S.torsoD * 0.9, P.shirtS, S.torsoW * 0.49, torsoTop - S.torsoH * 0.28, 0);
  skBox(g, S.torsoW * 0.92, 0.12, S.torsoD * 0.96, P.belt, 0, hipY + 0.14, 0);
  skBox(g, 0.12, 0.12, 0.06, P.gold, 0, hipY + 0.14, S.torsoD * 0.50);

  function limb(x, y, w, h2, d, c) {
    var p = new THREE.Group();
    p.position.set(x, y, 0);
    skBox(p, w, h2, d, c, 0, -h2 / 2, 0);
    g.add(p);
    return p;
  }
  var armL = limb(-S.armX, shoulderY, S.armW, S.armLen, S.armW, P.shirtD);
  var armR = limb(S.armX, shoulderY, S.armW, S.armLen, S.armW, P.shirt);
  [armL, armR].forEach(function (ar, i3) {
    var sleeve = i3 === 0 ? P.shirtD : P.shirt;
    skBox(ar, S.armW * 1.04, S.armLen * 0.52, S.armW * 1.04, sleeve, 0, -S.armLen * 0.26, 0);
    skBox(ar, S.armW * 1.06, 0.06, S.armW * 1.06, skShade(sleeve, 1.2), 0, -S.armLen * 0.52, 0);
    skBox(ar, S.armW * 0.86, S.armLen * 0.40, S.armW * 0.86, P.skin, 0, -S.armLen * 0.74, 0);
    skBox(ar, S.armW * 0.94, 0.12, S.armW * 0.94, P.skin, 0, handY + 0.05, 0);
  });

  var headG = new THREE.Group(); headG.position.set(0, headY, 0); g.add(headG);
  skBox(headG, S.headW, S.headH, S.headD, P.skin, 0, 0, 0);
  skBox(headG, S.headW * 0.86, 0.06, S.headD * 0.9, P.skinS, 0, -S.headH * 0.48, S.headD * 0.04);
  skBox(g, S.armW * 0.86, 0.10, S.armW * 0.86, P.skinS, 0, torsoTop + 0.03, 0);

  /* ★ round508：男生走 skFaceM（5 个方案 ✗ def.eyes.st 选）✦ 女生照旧 ✓ */
  /* ★ round509：眼睛 10 款（男女各一套）+ 嘴巴 10 款，都由 def.eyes 指定 */
  var _eye = def.eyes || { w: 0.26, h: 0.30 };
  if (_cus) {
    _eye = { w: _eye.w, h: _eye.h };
    if (typeof _cus.ey === 'number') { _eye.st = Math.max(1, Math.min(10, _cus.ey + 1)); }
    if (typeof _cus.mo === 'number') { _eye.mo = Math.max(1, Math.min(10, _cus.mo + 1)); }
  }
  if (def.g === 'm') {
    skFaceM(headG, S, P, _eye, _eye.st || 1);
  } else {
    skFace(headG, S, P, _eye, _eye.st || 1);
  }
  skHair(headG, S, P, def.hair, def.pin);

  var backG = new THREE.Group();
  backG.position.set(0, torsoTop - 0.30, -S.torsoD * 0.5);
  g.add(backG);

  skOutfit(g, S, P, def, hipY, torsoTop);
  skAcc(g, headG, armL, armR, S, P, def.acc, backG, hipY, torsoTop);

  armL.rotation.x = 0.10; armR.rotation.x = -0.12;
  legL.rotation.x = 0.04; legR.rotation.x = -0.04;

  var handPivot = new THREE.Group();
  handPivot.position.set(0.0, handY, 0.02);
  armR.add(handPivot);
  var sw = new THREE.Group();
  sw.rotation.x = 0.55;
  handPivot.add(sw);
  fillHeldWeapon(sw, null, null);

  var handPivotL = new THREE.Group();
  handPivotL.position.set(0.0, handY, 0.02);
  armL.add(handPivotL);
  var swL = new THREE.Group();
  swL.rotation.x = 0.55;
  swL.visible = false;
  handPivotL.add(swL);

  /* ★ round509：把头的坐标也带回去 ✗ 皮肤页/预览页要对着脸取景 ✓
     （以前只能"猜"头的中心，女生的头发一高就取歪了 ✓） */
  return { g: g, armL: armL, armR: armR, legL: legL, legR: legR, sw: sw, swL: swL,
           h: headY + S.headH / 2,
           headY: headY, headH: S.headH, headW: S.headW, S: S };
}

if (typeof window !== "undefined") { window.SKIN_DEFS = SKIN_DEFS; window.SKIN_ORDER = SKIN_ORDER; window.SKIN_NAME = SKIN_NAME; window.skBuildHero = skBuildHero; }
