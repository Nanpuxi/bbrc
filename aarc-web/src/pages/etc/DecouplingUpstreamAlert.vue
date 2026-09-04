<script setup lang="ts">
import { forkAarcName } from './routes/routesNames';

</script>

<template>
    <div class="derive-page decoupling-upstream-alert">
        <header class="hero">
            <span class="hero-icon">⚠️</span>
            <h1 class="hero-title">Fork 开发者注意</h1>
            <p class="hero-desc">
                本项目在 2026/9/3 经历了一场重大架构调整，将原前端项目（aarc 目录）的核心与外围设施进行了解耦和分离，形成两个目录（aarc-core 和 aarc-web）。
            </p>
        </header>

        <section class="section">
            <h2 class="purpose-title">这次调整的目的</h2>
            <div class="purpose-grid">
                <div class="purpose-item">
                    <span class="purpose-icon">🧩</span>
                    <h3 class="purpose-item-title">职责分离</h3>
                    <p class="purpose-text">编辑器核心（aarc-core）与站点外围设施（aarc-web）各司其职，仅保留 web 到 core 的单向依赖，结构更清晰、更易维护。</p>
                </div>
                <div class="purpose-item">
                    <span class="purpose-icon">🔄</span>
                    <h3 class="purpose-item-title">可替换外围设施</h3>
                    <p class="purpose-text">核心不再绑定特定宿主，可接入不同的外围实现，例如从零实现全自定义的保存/权限控制/分享/评论功能，或打包为 Tauri/Electron 本地安装应用。</p>
                </div>
            </div>
        </section>

        <section class="section">
            <div class="alert-card">
                <span class="alert-icon">🛑</span>
                <p class="alert-text">
                    如果需要从主仓库合并补丁，建议不要超过 <code class="commit-hash">793252da</code> 提交，除非你未对 aarc 目录进行大改动，或准备好了适配这次架构调整。
                </p>
            </div>
        </section>

        <section class="section">
            <div class="tip-card">
                <span class="tip-icon">📁</span>
                <p class="tip-text">
                    如果你在 aarc 目录新增了文件，更新后它们会残留在 aarc 目录内，你需要根据它们的用途，手动迁移到 <code>aarc-core</code> 或 <code>aarc-web</code> 目录的新位置。
                </p>
            </div>
        </section>

        <section class="section">
            <div class="docs-card">
                <h2 class="docs-title">详细信息</h2>
                <p class="docs-text">可参考主仓库 HEAD 的以下文档：</p>
                <ul class="docs-list">
                    <li><code>aarc-web\docs\decoupling.md</code></li>
                    <li><code>aarc-core\README.md</code></li>
                </ul>
            </div>
        </section>

        <section class="section">
            <div class="docs-card">
                <p class="docs-text" style="text-align: center;">
                    <RouterLink :to="{name: forkAarcName}">
                        <button>创建 Fork (定制开发)</button>
                    </RouterLink>
                </p>
                <p class="docs-text">“新外围设施” demo 项目以及最佳实践指南正在筹备中，敬请期待</p>
            </div>
        </section>
    </div>
</template>

<style scoped lang="scss">
@use './styles/derive-intro-pages.scss';

.decoupling-upstream-alert {
    .hero {
        margin-bottom: 18px;
        .hero-icon {
            display: inline-block;
            font-size: 2.4rem;
            margin-bottom: 8px;
        }
    }

    .section {
        margin-bottom: 18px;
    }

    .purpose-title {
        font-size: 1.2rem;
        font-weight: 600;
        margin: 0 0 12px;
        color: #111827;
    }

    .purpose-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 16px;

        .purpose-item {
            padding: 16px 18px;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            text-align: center;

            .purpose-icon {
                display: inline-block;
                font-size: 1.6rem;
                margin-bottom: 8px;
            }

            .purpose-item-title {
                font-size: 1.05rem;
                font-weight: 600;
                margin: 0 0 8px;
                color: #111827;
            }

            .purpose-text {
                font-size: 0.92rem;
                margin: 0;
                color: #4b5563;
            }
        }
    }

    @media (max-width: 768px) {
        .purpose-grid {
            grid-template-columns: 1fr;
        }
    }

    .alert-card {
        display: flex;
        align-items: flex-start;
        gap: 14px;
        padding: 14px 18px;
        border: 1px solid #fbbf24;
        border-left: 4px solid #f59e0b;
        border-radius: 12px;
        background: #fffbeb;

        .alert-icon {
            font-size: 1.4rem;
            line-height: 1.6;
            flex-shrink: 0;
        }

        .alert-text {
            margin: 0;
            color: #78350f;
            font-size: 1rem;

            .commit-hash {
                padding: 2px 8px;
                border-radius: 6px;
                background: #fef3c7;
                border: 1px solid #fde68a;
                font-family: Consolas, Monaco, monospace;
                font-size: 0.92em;
                color: #92400e;
                vertical-align: bottom;
            }
        }
    }

    .tip-card {
        display: flex;
        align-items: flex-start;
        gap: 14px;
        padding: 14px 18px;
        border: 1px solid #93c5fd;
        border-left: 4px solid #3b82f6;
        border-radius: 12px;
        background: #eff6ff;

        .tip-icon {
            font-size: 1.4rem;
            line-height: 1.6;
            flex-shrink: 0;
        }

        .tip-text {
            margin: 0;
            color: #1e3a8a;
            font-size: 1rem;

            code {
                padding: 2px 8px;
                border-radius: 6px;
                background: #dbeafe;
                border: 1px solid #bfdbfe;
                font-family: Consolas, Monaco, monospace;
                font-size: 0.92em;
                color: #1d4ed8;
                vertical-align: bottom;
            }
        }
    }

    .docs-card {
        padding: 14px 18px;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        background: #f9fafb;

        .docs-title {
            font-size: 1.1rem;
            font-weight: 600;
            margin: 0 0 8px;
            color: #111827;
        }

        .docs-text {
            margin: 0 0 10px;
            color: #4b5563;
        }

        .docs-list {
            margin: 0;
            padding-left: 20px;

            li {
                margin-bottom: 6px;

                code {
                    padding: 2px 8px;
                    border-radius: 6px;
                    background: #eef2f7;
                    border: 1px solid #e5e7eb;
                    font-family: Consolas, Monaco, monospace;
                    font-size: 0.92em;
                    color: #1f2937;
                }
            }
        }
    }
}
</style>
