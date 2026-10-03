/**
 * A Preact port of `@nkzw/stack` with the same props and inline style output.
 * Preact (unlike React) does not append `px` to numeric style values, so gaps
 * and paddings are converted explicitly.
 */
import {
  h,
  type ComponentChildren,
  type ComponentProps,
  type ComponentType,
  type CSSProperties,
  type JSX,
} from 'preact';

/**
 * Spacing scale used for layout gaps and paddings, in pixels. `true` applies
 * the default gap (8px).
 */
export type Gap = 0 | 1 | 2 | 4 | 8 | 12 | 16 | 20 | 24 | 28 | 32 | 36 | 40 | 44 | 48 | true;

type AlignContent =
  | 'start'
  | 'end'
  | 'center'
  | 'stretch'
  | 'space-between'
  | 'space-around'
  | 'space-evenly';

type AlignSelf = 'center' | 'end' | 'start' | 'stretch' | 'baseline';

type StackPropsInternal = {
  alignCenter?: boolean;
  alignEnd?: boolean;
  alignStart?: boolean;
  around?: boolean;
  baseline?: boolean;
  between?: boolean;
  center?: boolean;
  children?: ComponentChildren;
  columnGap?: Gap;
  content?: AlignContent;
  end?: boolean;
  evenly?: boolean;
  flex1?: boolean;
  gap?: Gap;
  horizontalPadding?: Gap;
  inline?: boolean;
  padding?: Gap;
  reverse?: boolean;
  rowGap?: Gap;
  safe?: boolean;
  self?: AlignSelf;
  shrink0?: boolean;
  stretch?: boolean;
  style?: CSSProperties;
  vertical?: boolean;
  verticalPadding?: Gap;
  wrap?: boolean;
};

type ElementType = keyof JSX.IntrinsicElements | ComponentType<any>;

export type StackProps<Component extends ElementType = 'div'> = StackPropsInternal & {
  /** The element to render, defaults to `<div />`. */
  as?: Component;
} & Omit<ComponentProps<Component>, keyof StackPropsInternal | 'as'>;

const defaultGap = 8;

const resolveGap = (gap: Gap | undefined) => (gap === true ? defaultGap : gap);

const resolveAlignment = (value: AlignContent | AlignSelf | undefined) =>
  value === 'start' ? 'flex-start' : value === 'end' ? 'flex-end' : value;

const px = (value: number | undefined) => (value == null ? undefined : `${value}px`);

export default function Stack<Component extends ElementType = 'div'>({
  alignCenter,
  alignEnd,
  alignStart,
  around,
  as,
  baseline,
  between,
  center,
  columnGap: _columnGap,
  content,
  end,
  evenly,
  flex1,
  gap: _gap,
  horizontalPadding,
  inline,
  padding,
  reverse,
  rowGap: _rowGap,
  safe,
  self,
  shrink0,
  stretch,
  style,
  vertical,
  verticalPadding,
  wrap,
  ...props
}: StackProps<Component>) {
  const baseStyle: CSSProperties = {
    alignContent: resolveAlignment(content),
    alignItems: alignStart
      ? 'flex-start'
      : alignCenter
        ? 'center'
        : alignEnd
          ? 'flex-end'
          : baseline
            ? 'baseline'
            : undefined,
    alignSelf: resolveAlignment(self),
    display: inline ? 'inline-flex' : 'flex',
    flexDirection: vertical
      ? reverse
        ? 'column-reverse'
        : 'column'
      : reverse
        ? 'row-reverse'
        : 'row',
    flexGrow: stretch ? 1 : undefined,
    flexShrink: shrink0 ? 0 : undefined,
    flexWrap: wrap ? 'wrap' : 'nowrap',
    justifyContent: center
      ? `${safe ? 'safe ' : ''}center`
      : end
        ? `${safe ? 'safe ' : ''}flex-end`
        : between
          ? 'space-between'
          : evenly
            ? 'space-evenly'
            : around
              ? 'space-around'
              : 'flex-start',
    ...(flex1 ? { flex: '1 1 0%' } : {}),
  };

  const gap = resolveGap(_gap);
  const rowGap = resolveGap(_rowGap);
  const columnGap = resolveGap(_columnGap);

  if (rowGap != null) {
    baseStyle.rowGap = px(rowGap);
  }
  if (columnGap != null) {
    baseStyle.columnGap = px(columnGap);
  }
  if (gap != null && rowGap == null && columnGap == null) {
    baseStyle.gap = px(gap);
  }

  const vGap = rowGap ?? gap;
  const hGap = columnGap ?? gap;

  if (padding === true) {
    if (vGap != null) {
      baseStyle.paddingTop = baseStyle.paddingBottom = px(vGap);
    }
    if (hGap != null) {
      baseStyle.paddingLeft = baseStyle.paddingRight = px(hGap);
    }
  } else if (padding != null) {
    baseStyle.padding = px(padding);
  } else {
    if (verticalPadding != null || vGap != null) {
      baseStyle.paddingTop = baseStyle.paddingBottom = px(
        verticalPadding === true ? vGap : verticalPadding,
      );
    }
    if (horizontalPadding != null || hGap != null) {
      baseStyle.paddingLeft = baseStyle.paddingRight = px(
        horizontalPadding === true ? hGap : horizontalPadding,
      );
    }
  }

  return h(as || 'div', { style: { ...baseStyle, ...style }, ...props } as never);
}

export const VStack = <Component extends ElementType = 'div'>(
  props: StackProps<Component> & { vertical?: never },
) => <Stack {...(props as StackProps<Component>)} vertical />;
