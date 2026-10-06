import type { PluginButtonIconProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";

/** The pill's usual icon in the warning color. Paseo owns the label's color. */
export function IdleShellsIcon({ size, theme }: PluginButtonIconProps) {
  return <Icon name="SquareTerminal" size={size} color={theme.colors.statusWarning} />;
}
