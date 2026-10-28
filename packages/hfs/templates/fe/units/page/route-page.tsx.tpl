import { {{Name}} } from "@/features/pages/{{Name}}"

/** The document title of this page, from the catalog of the requested locale. */
export { {{nameCamel}}Metadata as generateMetadata } from "@/features/pages/{{Name}}"

/** The {{route}} route's page slot: it mounts {{Name}} and nothing else. */
const Page = () => <{{Name}} />

export default Page
