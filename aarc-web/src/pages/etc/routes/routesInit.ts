import { Router } from "vue-router";
import { addToRouter } from "@/app/router/addToRouter";
import { sponsorWxName, donorsName, deriveWikiName, deriveRailchessName, forkAarcName, decouplingUpstreamAlertName } from "./routesNames";
import SponsorWx from "../SponsorWx.vue";
import Donors from "../Donors.vue";
import DeriveWiki from "../DeriveWiki.vue";
import DeriveRailchess from "../DeriveRailchess.vue";
import ForkAarc from "../ForkAarc.vue";
import DecouplingUpstreamAlert from "../DecouplingUpstreamAlert.vue";

export function addEtcPages(r: Router) {
    addToRouter(r, routes);
}

const routes = [
    {
        path: "/sponsor-wx",
        component: SponsorWx,
        name: sponsorWxName
    },
    {
        path: "/donors",
        component: Donors,
        name: donorsName
    },
    {
        path: "/derive-wiki",
        component: DeriveWiki,
        name: deriveWikiName
    },
    {
        path: "/derive-railchess",
        component: DeriveRailchess,
        name: deriveRailchessName
    },
    {
        path: "/fork-aarc",
        component: ForkAarc,
        name: forkAarcName
    },
    {
        path: "/decoupling-upstream-alert",
        component: DecouplingUpstreamAlert,
        name: decouplingUpstreamAlertName
    }
]
