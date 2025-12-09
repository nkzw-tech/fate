---
layout: home

hero:
  text: A modern data client for React & tRPC
  tagline: Inspired by Relay and GraphQL, fate combines view composition, normalized caching, data masking, Async React features, and tRPC's type safety.
  image:
    dark: /fate-logo-dark.svg
    light: /fate-logo.svg
    alt: VitePress
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: API Documentation
      link: /api
    - theme: alt
      text: View on GitHub
      link: https://github.com/nkzw-tech/fate
features:
  - title: View Composition
    icon: 🎑
    details: Components declare their data requirements using co-located "views". Views are composed into a single request per screen, minimizing network requests and eliminating waterfalls.
    link: /guide/core-concepts
    linkText: Thinking in Views
  - title: Async React
    icon: ⚛️
    details: fate uses modern Async React features like Actions, Suspense, and `use` for a seamless user experience. Optimistic updates enable instant UI feedback and rollbacks are handled automatically.
    link: /guide/actions
    linkText: Actions in fate
  - title: Data Masking & Strict Selection
    icon: 🥽
    details: fate prevents accidental coupling and overfetching by enforcing strict data selection for each view, and masks (hides) data that components did not request.
    link: /guide/views#type-safety-and-data-masking
    linkText: Data Masking
  - title: AI-Ready
    icon: ✨
    details: fate's minimal, predictable API and explicit data selection enable local reasoning, enabling humans and AI tools to generate stable, type-safe data-fetching code.
    link: https://github.com/nkzw-tech/fate-template/blob/main/AGENTS.md
    linkText: AGENTS.md
---

<script setup lang="ts">
import {
  ShaderMount,
  GrainGradientParams,
  getShaderColorFromString,
  defaultObjectSizing,
  grainGradientFragmentShader,
  GrainGradientShapes,
  GrainGradientUniforms,
  getShaderNoiseTexture,
  ShaderFitOptions,
} from '@paper-design/shaders';
import { onMounted, onBeforeUnmount, ref } from 'vue';

const config = {
  ...defaultObjectSizing,
  colorBack: '#00000000',
  colors: ['#3d87f5', '#2c64b6', '#d946ef', '#a855f7'],
  frame: 10_000,
  intensity: 0.5,
  noise: 0.25,
  shape: 'corners',
  softness: 0.5,
  speed: 1,
} satisfies GrainGradientParams;

const host = ref<HTMLElement | null>(null);

let cleanup: null | (() => void) = null;

const initialize = (element: HTMLElement) => {
  let shaderMount: ShaderMount | null = null;
  let img = getShaderNoiseTexture();

  if (img) {
    img.onload = () => {
      const uniforms = {
        // Own uniforms
        u_colorBack: getShaderColorFromString(config.colorBack),
        u_colors: config.colors.map(getShaderColorFromString),
        u_colorsCount: config.colors.length,
        u_intensity: config.intensity,
        u_noise: config.noise,
        u_noiseTexture: getShaderNoiseTexture(),
        u_shape: GrainGradientShapes[config.shape],
        u_softness: config.softness,

        // Sizing uniforms
        u_fit: ShaderFitOptions[config.fit],
        u_offsetX: 0,
        u_offsetY: 0,
        u_originX: 0,
        u_originY: 0,
        u_rotation: 0,
        u_scale: 1,
        u_worldHeight: config.worldHeight,
        u_worldWidth: config.worldWidth,
      } satisfies GrainGradientUniforms;

      shaderMount = new ShaderMount(
        element,
        grainGradientFragmentShader,
        uniforms,
        undefined,
        config.speed,
        config.frame,
        2,
        10_000_000,
      );

      document.body.append(element);
    };
  }

  return () => {
    shaderMount?.dispose();
    if (img) {
      img.onload = null;
      img = null;
    }
  };
};

onMounted(async () => {
  if (!host.value) {
    return;
  }

  cleanup = initialize(host.value);
});

onBeforeUnmount(() => {
  cleanup?.();
});
</script>

<template>
  <div ref="host" class="shader" />
</template>

<style scoped>
.shader {
  position: fixed;
  inset: 0;
  opacity: 0.2;
  z-index: -1;
  pointer-events: none;
}
</style>
