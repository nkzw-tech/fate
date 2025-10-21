import { AnchorHTMLAttributes } from 'react';
import {
  LinkProps as LinkPropsT,
  Link as ReactRouterLink,
  useLocation,
} from 'react-router';

export type LinkProps = LinkPropsT & AnchorHTMLAttributes<HTMLAnchorElement>;

export default function Link({ ...props }: LinkPropsT) {
  const { pathname: previousPathname } = useLocation();

  return <ReactRouterLink {...props} state={{ previousPathname }} />;
}
