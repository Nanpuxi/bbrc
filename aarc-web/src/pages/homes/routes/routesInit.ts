import { Router } from "vue-router";
import HomePage from "../HomePage.vue";
import HomePageOfficial from "../HomePageOfficial.vue";
import { addToRouter } from "@/app/router/addToRouter";
import { faq, homePageName } from "./routesNames";
import FAQ from "../FAQ.vue";
import Sudo from "../Sudo.vue";

export function addHomesPages(r:Router){
    addToRouter(r, routes);
}

const isFork = import.meta.env.VITE_IsFork == "true"
const homePage = isFork ? HomePage : HomePageOfficial

const routes = [
    {
        path:"/",
        component:homePage,
        name:homePageName
    },
    {
        path:"/faq",
        component:FAQ,
        name:faq
    },
    {
        path:"/sudo",
        component:Sudo,
        name:'sudo'
    }
]