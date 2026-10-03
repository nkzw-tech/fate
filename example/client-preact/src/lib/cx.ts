import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export default function cx(...inputs: Array<ClassValue>) {
  return twMerge(clsx(inputs));
}
