<script setup lang="ts">
import { guideInfo } from 'aarc-core/app/guideInfo';
import NewestSaves from '../components/NewestSaves.vue';
import GiteeInfo from '@/components/common/GiteeGitInfo.vue';
import { onMounted, ref } from 'vue';
import { appVersionCheck } from '@/app/appVersionCheck';
import SearchSaveEntrance from '../components/SearchSaveEntrance.vue';
import DonorList from '../components/DonorList.vue';
import { useEnteredCanvasFromStore } from '@/app/globalStores/enteredCanvasFrom';
import { useUserInfoStore } from '@/app/globalStores/userInfo';
import RecentUpdates from '../components/RecentUpdates.vue';
import Notice from 'aarc-core/components/common/Notice.vue';
import { userUpgradeToMemberName } from '../identities/routes/routesNames';
import { storeToRefs } from 'pinia';
import { useSaveListLocalConfigStore } from '@/app/localConfig/saveListLocalConfig.ts';
import { convertToProxyUrlIfNeeded } from 'aarc-core/utils/urlUtils/proxyUrl.ts';
import Combinations from '../components/Combinations.vue';
import { clientDownloadName, forkAarcName } from '../etc/routes/routesNames.ts';

const { setEnteredFrom } = useEnteredCanvasFromStore()
const userInfoStore = useUserInfoStore()
const { simpleCoopRulesDisplay } = storeToRefs(useSaveListLocalConfigStore())
const isFork = import.meta.env.VITE_IsFork == "true"
const welcome = import.meta.env.VITE_Welcome
const guideExtraExpanded = ref(false)

onMounted(()=>{
    appVersionCheck()
    setEnteredFrom()
})
</script>

<template>
<div class="welcome">
    <h1>欢迎</h1>
    <p>{{ welcome || 'AARC是用于快速绘制抽象线路图的工具' }}</p>
    <p v-if="!isFork">
        <b>
            <a style="color:green" href="/#/Editor/demo">点击此处立即试用</a>&nbsp;
            <a style="color:blueviolet" href="http://aarc.jowei19.com/#/Editor/188?viewOnly=1">使用说明</a>&nbsp;
            <a style="color:#cc88cc" href="/#/FAQ">常见问题</a>
        </b>
    </p>
    <template v-if="isFork">
        <p v-if="guideInfo.findHelp">遇到问题：{{ guideInfo.findHelp }}</p>
        <p v-if="guideInfo.extra" class="guideExtra" v-html="guideInfo.extra"></p>
    </template>
    <template v-else>
        <p v-if="guideInfo.findHelp">遇到问题：{{ guideInfo.findHelp }}
            <button v-if="guideInfo.extra" class="lite" @click="guideExtraExpanded=!guideExtraExpanded">
                {{ guideExtraExpanded ? '收起更多▲' : '更多社群▼' }}
            </button>
            <button class="lite" @click="simpleCoopRulesDisplay=!simpleCoopRulesDisplay">
                {{ simpleCoopRulesDisplay ? '收起' : '展开'}}合作提示{{ simpleCoopRulesDisplay ? '▲':'▼' }}
            </button>
        </p>
        <p v-if="guideInfo.extra && guideExtraExpanded" class="guideExtra" v-html="guideInfo.extra"></p>
    </template>
</div>
<template v-if="!isFork">
<Notice :type="'success'" :title="'🎉 好消息'" v-if="userInfoStore.userInfo.id && userInfoStore.userInfo.isTourist">
    现在无需加 qq 群即可免费转为正式用户，公开展示作品，使用多人协作功能：
    <RouterLink :to="{name:userUpgradeToMemberName}" style="color: white;text-decoration: underline;">立即转正</RouterLink>
</Notice>
<div v-else class="simple-coop-rules">
    <div v-if="simpleCoopRulesDisplay">
        ✅ 推荐：存档明显位置展示你建的QQ群号，让协作者在QQ群讨论发展方向/团队规定<br/>
        ✅ 可以：在存档中添加与存档发展有关的留言<br/>
        ❌ 请不要：把存档当聊天室/贴吧/伦坛使用（打错字是故意的）<br/>
        ❓如有疑问请咨询QQ交流群群主
    </div>
</div>
</template>
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
<div v-if="!isFork">
    <Combinations></Combinations>
    <p class="gotoDownload">
        <RouterLink :to="{name: clientDownloadName}">前往本地运行版下载页</RouterLink>
        或者
        <RouterLink :to="{name: forkAarcName}">开私服</RouterLink>
    </p>
</div>
<div v-if="!isFork" class="poker-frame">
    <a href="/#/derive-metroshuttle">
        <img class="poker-card" alt="metroshuttle"
            :src="convertToProxyUrlIfNeeded(`http://ms.jowei19.com/card-images/static/shanghai-longterm/station-12.webp`, 'icon')"/>
    </a>
</div>
<p v-if="!isFork" class="gotoDownload">
    <a href="/#/derive-metroshuttle">了解新游戏 MetroShuttle</a>
</p>
<div v-if="!isFork" class="marginedSection">
    <DonorList></DonorList>
</div>
<div v-if="!isFork" class="marginedSection">
    <a href="http://u.fsf.org/16e" style="display: block;margin: auto;width: 200px;" target="_blank">
        <img src="https://static.fsf.org/nosvn/images/badges/fsfs_icons_beige-bg.png" alt="Free Software, Free Society" style="width: 100%;">
    </a>
    <div class="smallNote" style="text-align: center;color:#CFBC5D">
        你对本软件拥有以下四条“软件自由”
        <p>自由之零：出于任何目的，运行程序的自由</p>
        <p>自由之一：研究程序如何工作，并使其适应你的需求的自由</p>
        <p>自由之二：重新分发副本的自由，以便你能够帮助他人</p>
        <p>自由之三：改进程序，并将你的改进公开发布的自由</p>
        <a href="http://u.fsf.org/16e" style="text-decoration: underline;" target="_blank">"软件自由"的详细解释</a>
        &nbsp;&nbsp;&nbsp;
        <a href="/#/about" style="text-decoration: underline;" target="_blank">AARC源码</a>
    </div>
</div>
<div v-if="!isFork" class="releaseNotes">
    <RecentUpdates></RecentUpdates>
</div>
<GiteeInfo v-if="!isFork"></GiteeInfo>
<div v-if="!isFork" class="roadmap">
    <h2>roadmap 重新整理中，敬请期待</h2>
</div>
<div v-if="!isFork" class="openSourceNote">
    本项目以<a href="https://apache.org/licenses/LICENSE-2.0" target="_blank">Apache-2.0</a>开源许可证提供，可私有部署和商用。
    欢迎对本项目源码作出贡献或提出改进意见。<br/>
    <a href="https://gitee.com/au114514/aarc" target="_blank">Gitee(本体)</a>&nbsp;
    <a href="https://github.com/Aurouscia/aarc" target="_blank">Github(自动同步镜像)</a>
    <div>本项目将用户的劳动成果保护放在第一位，不限制保存次数，请尽可能多保存。若出现误操作/他人破坏/恶性bug导致进度大量丢失，可使用备份回档。</div>
    <div style="color:cornflowerblue">承诺：不管后期添加多少功能，本项目永不以任何形式收取任何费用，所有功能全部开源免费。</div>
</div>
</template>

<style scoped lang="scss">
.releaseNotes{
   display: flex;
   flex-wrap: wrap;
   justify-content: center;
   align-items: stretch;
   gap: 10px;
}
.welcome{
    h1, p{
        text-align: center;
        color: #999;
        margin-bottom: 0.5em;
        white-space: pre-wrap;
        font-size: 14px;
        &.guideExtra {
            font-size: 14px;
        }
    }
    h1{
        font-size: 30px;
        padding-top: 10px;
        padding-bottom: 6px;
        margin-bottom: 6px;
    }
    a{
        text-decoration: underline;
        color: #999;
        &:hover{
            color: #333;
        }
    }
    button.lite{
        vertical-align: text-bottom;
        margin-left: 4px;
        color: #aaa;
    }
}
.simple-coop-rules{
    display: flex;
    flex-direction: column;
    gap: 8px;
    div{
        color: #333;
        background-color: #eee;
        border-radius: 10px;
        padding: 10px;
    }
}
.roadmap{
    margin-top: 30px;
    h2{
        text-align: center;
        font-size: 22px;
        border: solid;
        border-width: 0px 2px 0px 2px;
        margin: auto;
        margin-top: 10px;
        width: 120px;
    }
    h3{
        font-size: 18px;
    }
    h3, p{
        color: #999;
        text-align: center;
    }
    &>div{
        margin: 20px 0px 20px 0px;
    }
    p{
        font-size: 14px;
    }
    .done{
        h3, p{
            color: #ddd;
        }
    }
}
.openSourceNote{
    font-size: 14px;
    padding: 30px 0px 30px 0px;
    text-align: center;
    color: #aaa;
    a{
        text-decoration: underline;
        color: #aaa;
        &:hover{
            color: #333;
        }
    }
}
.marginedSection{
    margin: 16px 0px;
    .userTypeNote{
        text-align: center;
        color: palevioletred;
    }
}

.gotoDownload {
    text-align: center;
    a {
        color: cornflowerblue;
        text-decoration: underline;
    }
}

.poker-frame {
    width: 160px;
    margin: 50px auto 10px;
        // 扑克牌长宽比，圆角取短边（宽度）的 10%，竖直半径换算为高度的百分比
        aspect-ratio: 5 / 7;
        overflow: hidden;
        border-radius: 10% / 7.15%;
        box-shadow: 0 6px 14px rgba(0, 0, 0, 0.15);
        background: #f3f4f6;
        transition: transform 0.2s ease, box-shadow 0.2s ease;

        &:hover {
            transform: translate(6px, 6px);
            box-shadow: 0 14px 32px rgba(0, 0, 0, 0.3);
        }

        .poker-card {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
            cursor: pointer;
        }
    }
</style>