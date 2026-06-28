import { PageLoading } from "@/components/custom/page-loading";
import KeepAlive, { useKeepAliveRef } from "@/desktop/lib/keepalive-shim";
import { AnimatePresence, motion } from "motion/react";
import { Suspense, useMemo } from "react";
import { Outlet, useLocation } from "react-router-dom";
import ActivityBar from "./components/activity-bar";
import Main from "./components/main";
import { StartupConfigDialog } from "./components/startup-config-dialog";

export default function ChatLayout() {
	const aliveRef = useKeepAliveRef();
	const location = useLocation();

	const currentCacheKey = useMemo(() => {
		return location.pathname + location.search;
	}, [location.pathname, location.search]);

	return (
		<div className="flex h-screen w-screen bg-secondary">
			<ActivityBar />
			<Main>
				<Suspense
					fallback={
						<div className="flex flex-1 justify-center items-center">
							<PageLoading />
						</div>
					}
				>
					<KeepAlive
						aliveRef={aliveRef}
						activeCacheKey={currentCacheKey}
						transition
						max={5}
					>
						<AnimatePresence mode="wait">
							<motion.div
								className="flex flex-1 w-full h-full overflow-hidden"
								key={currentCacheKey}
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
								transition={{
									duration: 0.15,
									ease: "easeInOut",
								}}
							>
								<Outlet />
							</motion.div>
						</AnimatePresence>
					</KeepAlive>
				</Suspense>
			</Main>
			<StartupConfigDialog />
		</div>
	);
}
