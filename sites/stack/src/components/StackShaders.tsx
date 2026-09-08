// Adapted from cpojer-blog/src/notes/NotesPlaceholderShaders.tsx.
import {
  DitheringShapes,
  DitheringTypes,
  ditheringFragmentShader,
  getShaderColorFromString,
} from '@paper-design/shaders';
import { useEffect, useRef } from 'react';

const vertexShader = `#version 300 es
precision mediump float;

layout(location = 0) in vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const fragmentShader = ditheringFragmentShader
  .replace(
    'uniform float u_type;',
    `uniform float u_type;
uniform vec2 u_viewportOffset;
uniform float u_cornerRadius;`,
  )
  .replaceAll('gl_FragCoord.xy', '(gl_FragCoord.xy - u_viewportOffset)')
  .replace(
    'fragColor = vec4(color, opacity);',
    `vec2 tilePosition = (gl_FragCoord.xy - u_viewportOffset) - .5 * u_resolution;
  vec2 cornerDistance = abs(tilePosition) - .5 * u_resolution + vec2(u_cornerRadius);
  vec2 outsideCorner = max(cornerDistance, 0.);
  float squircleDistance = pow(
    pow(outsideCorner.x, 4.) + pow(outsideCorner.y, 4.),
    .25
  ) + min(max(cornerDistance.x, cornerDistance.y), 0.)
    - u_cornerRadius;
  float tileMask = 1. - smoothstep(-1., 0., squircleDistance);
  fragColor = vec4(color * tileMask, opacity * tileMask);`,
  );

type DitheringConfig = Readonly<{
  scale: number;
  shape: number;
  size: number;
  speed: number;
}>;

type TileRect = Readonly<{
  color: ReturnType<typeof getShaderColorFromString>;
  element: HTMLElement;
  height: number;
  index: number;
  radius: number;
  transformScale: number;
  width: number;
  x: number;
  y: number;
}>;

const configs: ReadonlyArray<DitheringConfig> = [
  {
    scale: 0.46,
    shape: DitheringShapes.simplex,
    size: 2,
    speed: 0.1,
  },
  {
    scale: 0.56,
    shape: DitheringShapes.warp,
    size: 2.25,
    speed: 0.06,
  },
  {
    scale: 0.82,
    shape: DitheringShapes.wave,
    size: 2,
    speed: 0.08,
  },
];

const transparent = getShaderColorFromString('#00000000');

function compileShader(gl: WebGL2RenderingContext, source: string, type: number) {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('Could not create the stack shader.');
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(message ?? 'Could not compile the stack shader.');
  }

  return shader;
}

function createProgram(gl: WebGL2RenderingContext) {
  const program = gl.createProgram();
  if (!program) {
    throw new Error('Could not create the stack shader program.');
  }

  const vertex = compileShader(gl, vertexShader, gl.VERTEX_SHADER);
  const fragment = compileShader(gl, fragmentShader, gl.FRAGMENT_SHADER);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(message ?? 'Could not link the stack shader.');
  }

  return program;
}

export default function StackShaders({
  animated = true,
  count,
  seedOffset = 0,
}: {
  animated?: boolean;
  count: number;
  seedOffset?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const grid = canvas?.closest<HTMLElement>('.shader-grid');
    if (!canvas || !grid || count === 0) {
      return;
    }

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
    });
    if (!gl) {
      return;
    }

    let program: WebGLProgram;
    try {
      program = createProgram(gl);
    } catch {
      return;
    }

    gl.useProgram(program);
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.SCISSOR_TEST);

    const uniform = (name: string) => gl.getUniformLocation(program, name);
    const uniforms = {
      colorBack: uniform('u_colorBack'),
      colorFront: uniform('u_colorFront'),
      cornerRadius: uniform('u_cornerRadius'),
      fit: uniform('u_fit'),
      offsetX: uniform('u_offsetX'),
      offsetY: uniform('u_offsetY'),
      originX: uniform('u_originX'),
      originY: uniform('u_originY'),
      pixelRatio: uniform('u_pixelRatio'),
      pxSize: uniform('u_pxSize'),
      resolution: uniform('u_resolution'),
      rotation: uniform('u_rotation'),
      scale: uniform('u_scale'),
      shape: uniform('u_shape'),
      time: uniform('u_time'),
      type: uniform('u_type'),
      viewportOffset: uniform('u_viewportOffset'),
      worldHeight: uniform('u_worldHeight'),
      worldWidth: uniform('u_worldWidth'),
    };

    gl.uniform4fv(uniforms.colorBack, transparent);
    gl.uniform1f(uniforms.fit, 0);
    gl.uniform1f(uniforms.originX, 0.5);
    gl.uniform1f(uniforms.originY, 0.5);
    gl.uniform1f(uniforms.type, DitheringTypes['4x4']);
    gl.uniform1f(uniforms.worldHeight, 0);
    gl.uniform1f(uniforms.worldWidth, 0);

    const darkTheme = window.matchMedia('(prefers-color-scheme: dark)');
    const hoverMedia = window.matchMedia('(hover: hover)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animationFrame = 0;
    let hoveredElement: HTMLElement | null = null;
    let isVisible = false;
    let lastDrawTime = performance.now();
    let lastRenderTime = 0;
    let motionUntil = 0;
    let renderScale = 1;
    let tileRects: ReadonlyArray<TileRect> = [];
    const animationTimes = Float32Array.from(
      { length: count },
      (_, index) => (seedOffset + index) * 0.73,
    );
    const hoverInfluences = new Float32Array(count);
    const hoverStartedAt = new Float64Array(count);
    const hoverStarts = new Float32Array(count);
    const hoverTargets = new Float32Array(count);
    const hoverTransitionDuration = 300;

    // Measure the transformed surfaces so the shared canvas follows the bounce.
    const updateTileRects = () => {
      const canvasBounds = canvas.getBoundingClientRect();
      tileRects = Array.from(grid.querySelectorAll<HTMLElement>('.shader-tile'), (tile, index) => {
        const bounds = tile.getBoundingClientRect();
        const scale = tile.offsetWidth ? bounds.width / tile.offsetWidth : 1;
        const inset = scale;
        const style = getComputedStyle(tile);
        return {
          color: getShaderColorFromString(style.color),
          element: tile,
          height: bounds.height - inset * 2,
          index,
          radius: Math.max(0, Number.parseFloat(style.borderTopLeftRadius) - 1) * scale,
          transformScale: scale,
          width: bounds.width - inset * 2,
          x: bounds.left - canvasBounds.left + inset,
          y: bounds.top - canvasBounds.top + inset,
        };
      });
    };

    const updateDimensions = () => {
      const { height, width } = canvas.getBoundingClientRect();
      if (height === 0 || width === 0) {
        return;
      }

      const maxDimension = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number;
      const pixelBudget = 2_400_000;
      renderScale = Math.max(
        1,
        Math.min(
          window.devicePixelRatio,
          Math.sqrt(pixelBudget / (width * height)),
          maxDimension / width,
          maxDimension / height,
        ),
      );
      canvas.width = Math.max(1, Math.round(width * renderScale));
      canvas.height = Math.max(1, Math.round(height * renderScale));

      updateTileRects();
    };

    const updateHoverInfluences = (time: number) => {
      if (reducedMotion.matches) {
        hoverInfluences.set(hoverTargets);
        return;
      }

      for (const rect of tileRects) {
        const progress = Math.min(
          1,
          Math.max(0, (time - hoverStartedAt[rect.index]) / hoverTransitionDuration),
        );
        const easedProgress = progress * progress * (3 - 2 * progress);
        hoverInfluences[rect.index] =
          hoverStarts[rect.index] +
          (hoverTargets[rect.index] - hoverStarts[rect.index]) * easedProgress;
      }
    };

    const draw = (time: number) => {
      const elapsed = Math.min(0.1, Math.max(0, (time - lastDrawTime) * 0.001));
      lastDrawTime = time;
      updateTileRects();
      updateHoverInfluences(time);
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.SCISSOR_TEST);
      const isDark = darkTheme.matches;
      const baseOpacity = isDark ? 0.24 : 0.17;
      const hoverOpacity = isDark ? 0.44 : 0.34;

      for (const rect of tileRects) {
        const seed = seedOffset + rect.index;
        const config = configs[seed % configs.length];
        const color = rect.color;
        const hoverInfluence = hoverInfluences[rect.index] * 0.65;
        if (animated && !reducedMotion.matches) {
          animationTimes[rect.index] =
            (animationTimes[rect.index] + elapsed * config.speed * (1 + hoverInfluence * 4)) % 20;
        }
        const scale = config.scale * (0.94 + ((seed * 7) % 5) * 0.03);
        const rotation = ((seed * 11) % 25) - 12;
        const offsetX = (((seed * 5 + 2) % 9) - 4) * 0.018;
        const offsetY = (((seed * 5) % 7) - 3) * 0.018;
        const x = Math.round(rect.x * renderScale);
        const y = Math.round(canvas.height - (rect.y + rect.height) * renderScale);
        const width = Math.round(rect.width * renderScale);
        const height = Math.round(rect.height * renderScale);

        gl.viewport(x, y, width, height);
        gl.scissor(x, y, width, height);
        gl.uniform2f(uniforms.viewportOffset, x, y);
        gl.uniform2f(uniforms.resolution, width, height);
        // Scale both the dither pixels and the underlying pattern with the card.
        gl.uniform1f(uniforms.pixelRatio, renderScale * rect.transformScale);
        gl.uniform1f(uniforms.cornerRadius, rect.radius * renderScale);
        gl.uniform4f(
          uniforms.colorFront,
          color[0],
          color[1],
          color[2],
          color[3] * (baseOpacity + (hoverOpacity - baseOpacity) * hoverInfluence),
        );
        gl.uniform1f(uniforms.shape, config.shape);
        gl.uniform1f(uniforms.pxSize, config.size);
        gl.uniform1f(uniforms.scale, scale);
        gl.uniform1f(uniforms.rotation, rotation);
        gl.uniform1f(uniforms.offsetX, offsetX);
        gl.uniform1f(uniforms.offsetY, offsetY);
        gl.uniform1f(uniforms.time, animationTimes[rect.index]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    };

    const animate = (time: number) => {
      if (!animated || !isVisible || reducedMotion.matches || document.hidden) {
        animationFrame = 0;
        return;
      }

      if (time < motionUntil || time - lastRenderTime >= 1000 / 24) {
        draw(time);
        lastRenderTime = time;
      }
      animationFrame = requestAnimationFrame(animate);
    };

    const start = () => {
      draw(performance.now());
      if (
        animated &&
        isVisible &&
        !reducedMotion.matches &&
        !document.hidden &&
        animationFrame === 0
      ) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    const setHoveredElement = (element: HTMLElement | null) => {
      if (hoveredElement === element) {
        return;
      }

      hoveredElement = element;
      const now = performance.now();
      motionUntil = now + 350;
      updateHoverInfluences(now);
      hoverStarts.set(hoverInfluences);
      hoverStartedAt.fill(now);
      hoverTargets.fill(0);
      if (element) {
        const gridBounds = canvas.getBoundingClientRect();
        const sourceBounds = element.getBoundingClientRect();
        const sourceRect = {
          height: sourceBounds.height,
          width: sourceBounds.width,
          x: sourceBounds.left - gridBounds.left,
          y: sourceBounds.top - gridBounds.top,
        };
        const activeTile = tileRects.find((rect) => rect.element === element);
        if (activeTile) {
          hoverTargets[activeTile.index] = 1;
        }
        const activeCenterX = sourceRect.x + sourceRect.width / 2;
        const activeCenterY = sourceRect.y + sourceRect.height / 2;
        const neighborPadding = Math.max(20, Math.min(sourceRect.width, sourceRect.height) * 0.15);

        for (const rect of tileRects) {
          if (
            rect.element !== element &&
            Math.abs(rect.x + rect.width / 2 - activeCenterX) <=
              (rect.width + sourceRect.width) / 2 + neighborPadding &&
            Math.abs(rect.y + rect.height / 2 - activeCenterY) <=
              (rect.height + sourceRect.height) / 2 + neighborPadding
          ) {
            hoverTargets[rect.index] = 0.3;
          }
        }
      }

      if (reducedMotion.matches) {
        hoverInfluences.set(hoverTargets);
      }
      start();
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!hoverMedia.matches || event.pointerType === 'touch') {
        return;
      }

      const target = event.target as Element | null;
      const tile =
        target?.closest('.project-card')?.querySelector<HTMLElement>('.shader-tile') ??
        target?.closest<HTMLElement>('.shader-tile');
      setHoveredElement(tile && grid.contains(tile) ? tile : null);
    };

    const handleFocus = (event: FocusEvent) => {
      const target = event.target as Element | null;
      const tile =
        target?.closest('.project-card')?.querySelector<HTMLElement>('.shader-tile') ??
        target?.closest<HTMLElement>('.shader-tile');
      setHoveredElement(tile && grid.contains(tile) ? tile : null);
    };
    const handlePress = () => {
      motionUntil = performance.now() + 350;
      start();
    };
    const handlePointerLeave = () => setHoveredElement(null);
    if (animated) {
      grid.addEventListener('pointerdown', handlePress);
      window.addEventListener('pointerup', handlePress);
      window.addEventListener('pointercancel', handlePress);
      grid.addEventListener('focusin', handleFocus);
      grid.addEventListener('focusout', handlePointerLeave);
      grid.addEventListener('pointermove', handlePointerMove);
      grid.addEventListener('pointerleave', handlePointerLeave);
    }

    const resizeObserver = new ResizeObserver(() => {
      updateDimensions();
      start();
    });
    resizeObserver.observe(grid);

    const visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry?.isIntersecting ?? false;
        if (isVisible) {
          start();
        } else if (animationFrame !== 0) {
          cancelAnimationFrame(animationFrame);
          animationFrame = 0;
        }
      },
      { rootMargin: '160px 0px' },
    );
    visibilityObserver.observe(grid);

    const handleModeChange = () => start();
    const handleVisibilityChange = () => start();
    darkTheme.addEventListener('change', handleModeChange);
    reducedMotion.addEventListener('change', handleModeChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    updateDimensions();
    start();

    return () => {
      if (animationFrame !== 0) {
        cancelAnimationFrame(animationFrame);
      }
      darkTheme.removeEventListener('change', handleModeChange);
      reducedMotion.removeEventListener('change', handleModeChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      grid.removeEventListener('pointerdown', handlePress);
      window.removeEventListener('pointerup', handlePress);
      window.removeEventListener('pointercancel', handlePress);
      grid.removeEventListener('focusin', handleFocus);
      grid.removeEventListener('focusout', handlePointerLeave);
      grid.removeEventListener('pointermove', handlePointerMove);
      grid.removeEventListener('pointerleave', handlePointerLeave);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      gl.deleteBuffer(positionBuffer);
      gl.deleteProgram(program);
    };
  }, [animated, count, seedOffset]);

  return (
    <div aria-hidden="true" className="shader-layer">
      <canvas className="stack-shaders" ref={canvasRef} />
    </div>
  );
}
