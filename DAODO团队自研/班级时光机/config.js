// ================================================================
//  📦 配置文件 config.js
//  包含：Supabase密钥、常量、等级配置、敏感词、地区树
// ================================================================

// ---------- Supabase 配置 ----------
var CONFIG = {
    SUPABASE_URL: 'https://agpznniqfxdeudwvimbb.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_0TcgungxkhJpKIJf2bHdLA_X14JILIp'
};

// ---------- 敏感词过滤 ----------
var SENSITIVE_WORDS = ['傻逼','SB','sb','fuck','Fuck','操','cao','妈的','尼玛','脑残','白痴','垃圾','废物','死全家','狗日','妈逼','贱人','婊子','畜生'];

// ---------- 等级配置 ----------
var LEVEL_CONFIG = [
    { level: 0, exp: 0, color: '#b0a098', title: '🌱 班级萌芽' },
    { level: 1, exp: 0, color: '#b0a098', title: '🌱 班级萌芽' },
    { level: 2, exp: 300, color: '#8B6B4A', title: '📖 学习委员' },
    { level: 3, exp: 750, color: '#b8860b', title: '✏️ 课代表' },
    { level: 4, exp: 1000, color: '#cd853f', title: '🌟 班级新星' },
    { level: 5, exp: 1500, color: '#d4a574', title: '🔥 班级达人' },
    { level: 6, exp: 2000, color: '#c9a84c', title: '🏆 班级之星' },
    { level: 7, exp: 3000, color: '#e8d5a3', title: '👑 班级精英' },
    { level: 8, exp: 5000, color: '#d4af37', title: '🌟 班级传奇' },
    { level: 9, exp: 8000, color: '#c9a84c', title: '🏛️ 班级名人' },
    { level: 10, exp: 10000, color: 'linear-gradient(135deg,#4589C4,#7E3ACB)', title: '🎖️ 超凡之上' }
];

// ---------- 地区树 ----------
var AREA_TREE = [
    {
        name: "银河系", children: [
            {
                name: "太阳系", children: [
                    {
                        name: "地球", children: [
                            {
                                name: "中国", children: [
                                    { name: "安徽省", children: [{ name: "合肥市" }, { name: "芜湖市" }, { name: "马鞍山市" }] },
                                    { name: "江苏省", children: [{ name: "南京市" }, { name: "苏州市" }] },
                                    { name: "广东省", children: [{ name: "广州市" }, { name: "深圳市" }] }
                                ]
                            }
                        ]
                    },
                    { name: "月球", children: [{ name: "广寒宫" }] },
                    { name: "火星", children: [{ name: "火星基地" }] }
                ]
            }
        ]
    }
];

// ---------- 当前版本 ----------
var currentVersion = 'v3.1.0';
