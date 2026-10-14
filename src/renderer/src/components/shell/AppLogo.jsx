import logo from "../../assets/logo.png";

export function AppLogo({ size = 18 }) {
  return <img src={logo} alt="" width={size} height={size} draggable={false} className="shrink-0 select-none" />;
}
