<script setup lang="ts">
import { onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import Carousel from 'aarc-core/components/common/Carousel.vue';
import NewestSaves from '../components/NewestSaves.vue';
import SearchSaveEntrance from '../components/SearchSaveEntrance.vue';
import RecentUpdatesCollapsible from '../components/RecentUpdatesCollapsible.vue';
import DonorList from '../components/DonorList.vue';
import { appVersionCheck } from '@/app/appVersionCheck';
import { useEnteredCanvasFromStore } from '@/app/globalStores/enteredCanvasFrom';
import { useUserInfoStore } from '@/app/globalStores/userInfo';
import { useHomePageLocalConfigStore } from '@/app/localConfig/homePageLocalConfig';
import { userUpgradeToMemberName } from '../identities/routes/routesNames';

const { setEnteredFrom } = useEnteredCanvasFromStore()
const userInfoStore = useUserInfoStore()
const { upgradeGuideDisplay, coopRulesDisplay } = storeToRefs(useHomePageLocalConfigStore())

const heroSlides = [
    { big: '共享', small: '团队协作，无限可能，可追踪可审计', gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
    { big: '开放', small: '完全开源，自主可控，随心 fork 定制', gradient: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)' },
    { big: '永久免费', small: '过去免费，现在免费，未来也免费，不设会员升级', gradient: 'linear-gradient(135deg, #ff9966 0%, #ff5e62 100%)' },
    { big: 'AARC', small: '方便快捷的线路图绘制工具', gradient: 'linear-gradient(135deg, #141e30 0%, #4b6cb7 100%)' },
]

interface TutorialCard {
    title: string
    desc: string
    emoji: string
    /** 图片路径（位于 public 下）；缺省时显示 emoji 占位 */
    image?: string
    href: string
    external?: boolean
}
interface TutorialGroup {
    name: string
    cards: TutorialCard[]
}
const tutorialGroups: TutorialGroup[] = [
    {
        name: '基础教程',
        cards: [
            { title: '快速上手', desc: '打开编辑器，五分钟画出第一条线路', emoji: '🚀', href: '/#/Editor/demo' },
            { title: '使用说明', desc: '完整的图文功能说明', emoji: '📖', href: 'http://aarc.jowei19.com/#/Editor/188?viewOnly=1', external: true },
            { title: '常见问题', desc: '遇到问题？先看这里', emoji: '❓', href: '/#/FAQ' },
        ]
    },
    {
        name: '最新功能',
        cards: [
            { title: '多人协作', desc: '与团队成员同时编辑同一张图', emoji: '👥', href: 'http://aarc.jowei19.com/#/Editor/188?viewOnly=1', external: true },
            { title: '本地运行版', desc: '离线使用，数据存储在自己的设备上', emoji: '💾', href: '/#/client-download' },
            { title: '开私服', desc: '部署属于你自己的 AARC 实例', emoji: '🛠️', href: '/#/fork-aarc' },
        ]
    },
]

interface MoreLink {
    text: string
    href: string
    external?: boolean
}
interface MoreSection {
    title: string
    emoji: string
    paras: string[]
    links?: MoreLink[]
}
const moreSections: MoreSection[] = [
    {
        title: '协作功能',
        emoji: '🤝',
        paras: [
            '可多人同时编辑同一线路图：一人画线、一人排站、一人校订，分工协作互不等待。所有改动实时同步给房间内的每个人，并完整留痕——谁在什么时间改了什么，可追踪、可审计，出现分歧可以回溯每一处变更的来源。',
            '组件自己的创作团队：在存档明显位置留下你们的 QQ 群号，把线路图变成团队的共同作品，而不只是一个人的草稿。',
        ]
    },
    {
        title: '本地运行',
        emoji: '💾',
        paras: [
            '如果对在线服务的稳定性或数据托管不放心，可以下载本地运行版：完全离线使用，线路图数据存储在自己的设备上，不经任何服务器；版本更新由你自主决定，不存在"强制升级后才能继续使用"。',
        ],
        links: [
            { text: '前往本地运行版下载页', href: '/#/client-download' },
        ]
    },
    {
        title: '软件自由',
        emoji: '🕊️',
        paras: [
            '软件自由意味着你对软件有完整的控制权：不会被账号体系、订阅制或平台政策捆绑，你使用本工具的权利任何人无法剥夺——因为源代码完全公开，运行什么样的服务、改成什么样子，都由你决定。',
            '例如，如果你对官方站的某项政策不满，可以自行部署一个实例、迁移全部数据并继续创作，而不是被迫接受或放弃积累已久的作品。',
        ],
        links: [
            { text: '了解如何开私服', href: '/#/fork-aarc' },
            { text: '"软件自由"的详细解释', href: 'http://u.fsf.org/16e', external: true },
        ]
    },
    {
        title: '模块化架构',
        emoji: '🧩',
        paras: [
            '本应用的"网站部分"与"编辑器部分"是解耦的：编辑器是独立的 aarc-core 包，不依赖站点的任何功能。',
            '你可以把编辑器部分单独取出，嵌入自己另外开发的网站或本地应用中，或者与其他工具组成工具集。',
        ]
    },
    {
        title: '永久免费',
        emoji: '🆓',
        paras: [
            '本应用为公益性项目，承诺永久开源免费：过去免费，现在免费，未来也免费。不管后期添加多少功能，永不以任何形式收取任何费用，不设会员、不设付费解锁。',
        ]
    },
]

onMounted(()=>{
    appVersionCheck()
    setEnteredFrom()
})
</script>

<template>
<div class="home-official">
    <div class="hero">
        <Carousel :count="heroSlides.length" :auto-play="true" :auto-interval-ms="2000" :fade="true">
            <template #default="{ index }">
                <div class="heroCard">
                    <div class="heroBig" :style="{ backgroundImage: heroSlides[index].gradient }">{{ heroSlides[index].big }}</div>
                    <div class="heroSmall">{{ heroSlides[index].small }}</div>
                </div>
            </template>
        </Carousel>
    </div>

    <div v-if="userInfoStore.userInfo.id && userInfoStore.userInfo.isTourist" class="marginedSection">
        <div class="upgradeGuide">
            <div class="upgradeHead">
                <span class="upgradeTitle">🎉 绑定邮箱，免费转正</span>
                <button class="lite" @click="upgradeGuideDisplay=!upgradeGuideDisplay">
                    {{ upgradeGuideDisplay ? '收起▲' : '展开▼' }}
                </button>
            </div>
            <div v-if="upgradeGuideDisplay" class="upgradeBody">
                绑定邮箱即可免费转为正式用户，无需加群审核：公开展示你的作品，使用多人协作功能。
                <RouterLink :to="{name:userUpgradeToMemberName}" class="upgradeLink">立即转正</RouterLink>
            </div>
        </div>
    </div>
    <div v-else class="marginedSection">
        <div class="coopRules">
            <div class="coopRulesHead">
                <span class="coopRulesTitle">创作规范</span>
                <button class="lite" @click="coopRulesDisplay=!coopRulesDisplay">
                    {{ coopRulesDisplay ? '收起▲' : '展开▼' }}
                </button>
            </div>
            <div v-if="coopRulesDisplay" class="coopRulesBody">
                ✅ 推荐：存档明显位置展示你建的QQ群号，让协作者在QQ群讨论发展方向/团队规定<br/>
                ✅ 可以：在存档中添加与存档发展有关的留言<br/>
                ❌ 请不要：把存档当聊天室/贴吧/论坛使用<br/>
                ❓如有疑问请咨询QQ交流群群主
            </div>
        </div>
    </div>

    <div class="marginedSection">
        <NewestSaves></NewestSaves>
        <div v-if="userInfoStore.isLoginedTourist" class="userTypeNote">当前账号为游客，作品无法公开展示</div>
    </div>
    <div v-if="userInfoStore.isAdmin" class="marginedSection">
        <div class="userTypeNote">当前账号为管理，请监视以下游客情况（不要随意给人转正）</div>
        <NewestSaves :for-auditor="true"></NewestSaves>
    </div>

    <div class="marginedSection">
        <SearchSaveEntrance></SearchSaveEntrance>
    </div>

    <div class="marginedSection tutorials">
        <div v-for="group in tutorialGroups" :key="group.name" class="tutorialGroup">
            <h2 class="tutorialGroupName">{{ group.name }}</h2>
            <div class="tutorialGrid">
                <a
                    v-for="card in group.cards"
                    :key="card.title"
                    class="tutorialCard"
                    :href="card.href"
                    :target="card.external ? '_blank' : undefined"
                >
                    <div class="tutorialImage">
                        <img v-if="card.image" :src="card.image" :alt="card.title"/>
                        <span v-else class="tutorialEmoji">{{ card.emoji }}</span>
                    </div>
                    <div class="tutorialTitle">{{ card.title }}</div>
                    <div class="tutorialDesc">{{ card.desc }}</div>
                </a>
            </div>
        </div>
    </div>

    <div class="marginedSection">
        <RecentUpdatesCollapsible></RecentUpdatesCollapsible>
    </div>

    <div class="marginedSection moreSections">
        <div v-for="sec in moreSections" :key="sec.title" class="moreSection">
            <h3>{{ sec.emoji }} {{ sec.title }}</h3>
            <p v-for="(para, i) in sec.paras" :key="i">{{ para }}</p>
            <p v-if="sec.links?.length" class="moreLinks">
                <a
                    v-for="link in sec.links"
                    :key="link.text"
                    :href="link.href"
                    :target="link.external ? '_blank' : undefined"
                >{{ link.text }}</a>
            </p>
        </div>
    </div>

    <div class="marginedSection">
        <DonorList></DonorList>
    </div>
</div>
</template>

<style scoped lang="scss">
$serif: "Songti SC", "STSong", "Noto Serif CJK SC", "SimSun", Georgia, serif;

.home-official{
    padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px));
}
.marginedSection{
    margin: 16px 0px;
    .userTypeNote{
        text-align: center;
        color: palevioletred;
    }
}

.hero{
    margin-top: 10px;
    .heroCard{
        flex: 1;
        min-width: 0;
        height: 180px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        gap: 12px;
        padding: 0 24px;
        text-align: center;
        .heroBig{
            font-family: $serif;
            font-size: 44px;
            font-weight: bold;
            letter-spacing: 4px;
            padding-left: 4px;
            background: linear-gradient(135deg, #667eea, #764ba2);
            background-clip: text;
            -webkit-background-clip: text;
            color: transparent;
        }
        .heroSmall{
            font-size: 16px;
            color: #5a5f6e;
        }
    }
    @media screen and (max-width: 768px) {
        .heroCard{
            height: 140px;
            .heroBig{
                font-size: 32px;
            }
            .heroSmall{
                font-size: 14px;
            }
        }
    }
}

.upgradeGuide, .coopRules{
    border-radius: 12px;
    padding: 12px 16px;
    color: #333;
    font-size: 14px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}
.upgradeGuide{
    background: linear-gradient(135deg, #e8f9ee 0%, #d2efe0 100%);
    border: 1px solid rgba(69, 183, 122, 0.35);
}
.coopRules{
    background: linear-gradient(135deg, #f2f5fa 0%, #e3eaf4 100%);
    border: 1px solid rgba(120, 140, 180, 0.25);
}
.upgradeHead, .coopRulesHead{
    display: flex;
    justify-content: space-between;
    align-items: center;
    .upgradeTitle, .coopRulesTitle{
        font-family: $serif;
        font-weight: bold;
        font-size: 15px;
        color: #2c3142;
    }
    button.lite{
        color: #999;
    }
}
.upgradeBody, .coopRulesBody{
    margin-top: 8px;
    line-height: 1.8;
}
.upgradeLink{
    display: inline-block;
    color: #fff;
    background: linear-gradient(135deg, #43c47f, #2ba360);
    border-radius: 999px;
    padding: 2px 14px;
    text-decoration: none;
    margin-left: 6px;
    white-space: nowrap;
    box-shadow: 0 2px 6px rgba(43, 163, 96, 0.35);
}

.tutorials{
    .tutorialGroup{
        margin-bottom: 24px;
    }
    .tutorialGroupName{
        font-family: $serif;
        font-size: 20px;
        color: #2c3142;
        margin: 0 0 12px 0;
        display: flex;
        align-items: center;
        gap: 10px;
        &::before{
            content: '';
            flex: none;
            width: 4px;
            height: 18px;
            border-radius: 2px;
            background: linear-gradient(180deg, #667eea, #764ba2);
        }
    }
    .tutorialGrid{
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 14px;
    }
    @media screen and (max-width: 768px) {
        .tutorialGrid{
            grid-template-columns: 1fr;
        }
    }
    .tutorialCard{
        display: flex;
        flex-direction: column;
        gap: 8px;
        background: #fff;
        border: 1px solid #ececec;
        border-radius: 12px;
        padding: 12px;
        text-decoration: none;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        &:hover{
            transform: translateY(-3px);
            box-shadow: 0 8px 20px rgba(60, 70, 120, 0.15);
        }
        .tutorialImage{
            aspect-ratio: 16 / 9;
            border-radius: 8px;
            background: linear-gradient(135deg, #a8c0ff, #3f2b96);
            display: flex;
            justify-content: center;
            align-items: center;
            overflow: hidden;
            img{
                width: 100%;
                height: 100%;
                object-fit: cover;
            }
            .tutorialEmoji{
                font-size: 40px;
                filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
            }
        }
        &:nth-child(3n+2) .tutorialImage{
            background: linear-gradient(135deg, #43e0c0, #11998e);
        }
        &:nth-child(3n) .tutorialImage{
            background: linear-gradient(135deg, #ffb37b, #ff5e62);
        }
        .tutorialTitle{
            font-size: 16px;
            font-weight: bold;
            color: #333;
        }
        .tutorialDesc{
            font-size: 14px;
            color: #999;
        }
    }
}

.moreSections{
    max-width: 600px;
    margin-left: auto;
    margin-right: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
    .moreSection{
        padding: 4px 2px;
        &:nth-child(even){
            text-align: right;
        }
        h3{
            margin: 0 0 8px 0;
            font-size: 18px;
            font-family: $serif;
            color: #2c3142;
        }
        p{
            margin: 6px 0;
            font-size: 14px;
            color: #5a5f6e;
            line-height: 1.8;
        }
        .moreLinks{
            a{
                color: #5a67d8;
                text-decoration: none;
                margin-right: 16px;
                &:hover{
                    text-decoration: underline;
                }
            }
        }
    }
}
</style>
