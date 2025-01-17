import flower from './Item_Heart_of_Comradeship.png'
import plume from './Item_Feather_of_Homecoming.png'
import sands from './Item_Sundial_of_the_Sojourner.png'
import goblet from './Item_Goblet_of_the_Sojourner.png'
import circlet from './Item_Crown_of_Parting.png'
import { IArtifactSheet } from '../../../Types/artifact'
const artifact: IArtifactSheet = {
  name: "Resolution of Sojourner", rarity: [3, 4],
    icons: {
    flower,
    plume,
    sands,
    goblet,
    circlet
  },
  setEffects: {
    2: {
            stats: { atk_: 18 }
    },
    4: {
            stats: { charged_critRate_: 30 }
    }
  }
}
export default artifact