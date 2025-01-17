import { faCheckSquare, faSquare, faTimes, faTrash, faUndo } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { lazy, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Accordion, Alert, Badge, Button, ButtonGroup, Card, Col, Container, Dropdown, DropdownButton, Image, InputGroup, ListGroup, Modal, OverlayTrigger, ProgressBar, Row, Tooltip } from 'react-bootstrap';
import ReactGA from 'react-ga';
// eslint-disable-next-line
import Worker from "worker-loader!./BuildWorker";
import Artifact from '../Artifact/Artifact';
import { ArtifactSheet } from '../Artifact/ArtifactSheet';
import SetEffectDisplay from '../Artifact/Component/SetEffectDisplay';
import SlotNameWithIcon, { artifactSlotIcon } from '../Artifact/Component/SlotNameWIthIcon';
import Character from '../Character/Character';
import CharacterCard from '../Character/CharacterCard';
import { ContextAwareToggle, EnemyEditor, EnemyResText, HitModeToggle, InfusionAuraDropdown, ReactionToggle } from '../Character/CharacterDisplay/DamageOptionsAndCalculation';
import StatDisplayComponent from '../Character/CharacterDisplay/StatDisplayComponent';
import { CharacterSelectionDropdownList } from '../Character/CharacterSelection';
import CharacterSheet from '../Character/CharacterSheet';
import { getFormulaTargetsDisplayHeading } from '../Character/CharacterUtil';
import CustomFormControl from '../Components/CustomFormControl';
import FieldDisplay from '../Components/FieldDisplay';
import InfoComponent from '../Components/InfoComponent';
import { Stars } from '../Components/StarDisplay';
import StatIcon from '../Components/StatIcon';
import { DatabaseContext } from '../Database/Database';
import { dbStorage } from '../Database/DBStorage';
import Formula from '../Formula';
import useCharacterReducer from '../ReactHooks/useCharacterReducer';
import useForceUpdate from '../ReactHooks/useForceUpdate';
import usePromise from '../ReactHooks/usePromise';
import Stat from '../Stat';
import { StatKey } from '../Types/artifact';
import { ArtifactsBySlot, Build, BuildSetting } from '../Types/Build';
import { ICachedCharacter } from '../Types/character';
import { allElements, allSlotKeys, ArtifactSetKey, CharacterKey, SetNum, SlotKey } from '../Types/consts';
import { IFieldDisplay } from '../Types/IFieldDisplay';
import { ICalculatedStats } from '../Types/stats';
import statsToFields from '../Util/FieldUtil';
import { timeStringMs } from '../Util/TimeUtil';
import { crawlObject, deepClone, objectFromKeyMap } from '../Util/Util';
import WeaponSheet from '../Weapon/WeaponSheet';
import { buildContext, calculateTotalBuildNumber, maxBuildsToShowList } from './Build';
import { initialBuildSettings } from './BuildSetting';
const InfoDisplay = React.lazy(() => import('./InfoDisplay'));

//lazy load the character display
const CharacterDisplayCard = lazy(() => import('../Character/CharacterDisplayCard'))

const warningBuildNumber = 10000000

const artifactsSlotsToSelectMainStats = ["sands", "goblet", "circlet"] as const

function buildSettingsReducer(state: BuildSetting, action): BuildSetting {
  switch (action.type) {
    case 'mainStatKey': {
      const { slotKey, mainStatKey } = action
      const mainStatKeys = { ...state.mainStatKeys }//create a new object to update react dependencies

      if (state.mainStatKeys[slotKey].includes(mainStatKey))
        mainStatKeys[slotKey] = mainStatKeys[slotKey].filter(k => k !== mainStatKey)
      else
        mainStatKeys[slotKey].push(mainStatKey)
      return { ...state, mainStatKeys }
    }
    case 'mainStatKeyReset': {
      const { slotKey } = action
      const mainStatKeys = { ...state.mainStatKeys }//create a new object to update react dependencies
      mainStatKeys[slotKey] = []
      return { ...state, mainStatKeys }
    }
    case `setFilter`: {
      const { index, key, num = 0 } = action
      state.setFilters[index] = { key, num }
      return { ...state, setFilters: [...state.setFilters] }//do this because this is a dependency, so needs to be a "new" array
    }
    default:
      break;
  }
  return { ...state, ...action }
}

export default function BuildDisplay({ location: { characterKey: propCharacterKey } }) {
  const database = useContext(DatabaseContext)
  const [characterKey, setcharacterKey] = useState(() => {
    const { characterKey = "" } = dbStorage.get("BuildsDisplay.state") ?? {}
    //NOTE that propCharacterKey can override the selected character.
    return (propCharacterKey ?? characterKey) as CharacterKey | ""
  })

  const [modalBuild, setmodalBuild] = useState(-1) // the index of the newBuild that is being displayed in the character modal,
  const [showArtCondModal, setshowArtCondModal] = useState(false)
  const [showCharacterModal, setshowCharacterModal] = useState(false)

  const [generatingBuilds, setgeneratingBuilds] = useState(false)
  const [generationProgress, setgenerationProgress] = useState(0)
  const [generationDuration, setgenerationDuration] = useState(0)//in ms
  const [generationSkipped, setgenerationSkipped] = useState(0)

  const [charDirty, setCharDirty] = useForceUpdate()
  const artifactSheets = usePromise(ArtifactSheet.getAll(), [])

  const [artsDirty, setArtsDirty] = useForceUpdate()

  const isMounted = useRef(false)

  const worker = useRef(null as Worker | null)

  type characterDataType = { character?: ICachedCharacter, characterSheet?: CharacterSheet, weaponSheet?: WeaponSheet, initialStats?: ICalculatedStats, statsDisplayKeys?: { basicKeys: any, [key: string]: any } }
  const [{ character, characterSheet, weaponSheet, initialStats, statsDisplayKeys }, setCharacterData] = useState({} as characterDataType)
  const buildSettings = useMemo(() => character?.buildSettings ?? initialBuildSettings(), [character])
  const { setFilters, statFilters, mainStatKeys, optimizationTarget, mainStatAssumptionLevel, useExcludedArts, useEquippedArts, builds, buildDate, maxBuildsToShow } = buildSettings

  if (initialStats)
    initialStats.mainStatAssumptionLevel = mainStatAssumptionLevel

  const buildStats = useMemo(() => {
    if (!initialStats || !artifactSheets) return []
    return builds.map(build => {
      const arts = Object.fromEntries(build.map(id => database._getArt(id)).map(art => [art?.slotKey, art]))
      return Character.calculateBuildwithArtifact(initialStats, arts, artifactSheets)
    }).filter(build => build)
  }, [builds, database, initialStats, artifactSheets])

  const buildSettingsDispatch = useCallback((action) => {
    if (!character) return
    character.buildSettings = buildSettingsReducer(buildSettings, action)
    database.updateChar(character)
  }, [character, buildSettings, database])

  useEffect(() => ReactGA.pageview('/build'), [])

  //select a new character Key
  const selectCharacter = useCallback((cKey = "") => {
    if (characterKey === cKey) return
    setcharacterKey(cKey)
    setCharDirty()
    setCharacterData({})
  }, [setCharDirty, setcharacterKey, characterKey])

  //load the character data as a whole
  useEffect(() => {
    (async () => {
      if (!characterKey || !artifactSheets) return
      const character = database._getChar(characterKey)
      if (!character) return selectCharacter("")// character is prob deleted.
      const characterSheet = await CharacterSheet.get(characterKey)
      const weapon = database._getWeapon(character.equippedWeapon)
      if (!weapon) return
      const weaponSheet = await WeaponSheet.get(weapon.key)
      if (!characterSheet || !weaponSheet) return
      const initialStats = Character.createInitialStats(character, database, characterSheet, weaponSheet)
      //NOTE: since initialStats are used, there are no inclusion of artifact formulas here.
      const statsDisplayKeys = Character.getDisplayStatKeys(initialStats, { characterSheet, weaponSheet, artifactSheets })
      setCharacterData({ character, characterSheet, weaponSheet, initialStats, statsDisplayKeys })
    })()
  }, [charDirty, characterKey, artifactSheets, database, selectCharacter])

  //register changes in artifact database
  useEffect(() =>
    database.followAnyArt(setArtsDirty),
    [setArtsDirty, database])

  //register changes in character in db
  useEffect(() =>
    characterKey ? database.followChar(characterKey, setCharDirty) : undefined,
    [characterKey, setCharDirty, database])

  //terminate worker when component unmounts
  useEffect(() => () => worker.current?.terminate(), [])

  //save to BuildsDisplay.state on change
  useEffect(() => {
    if (isMounted.current) dbStorage.set("BuildsDisplay.state", { characterKey })
    else isMounted.current = true
  }, [characterKey])

  //validate optimizationTarget 
  useEffect(() => {
    if (!statsDisplayKeys) return
    if (!Array.isArray(optimizationTarget)) return
    for (const sectionKey in statsDisplayKeys) {
      const section = statsDisplayKeys[sectionKey]
      for (const keys of section)
        if (JSON.stringify(keys) === JSON.stringify(optimizationTarget)) return
    }
    buildSettingsDispatch({ optimizationTarget: initialBuildSettings().optimizationTarget })
  }, [optimizationTarget, statsDisplayKeys, buildSettingsDispatch])

  const { split, totBuildNumber } = useMemo(() => {
    if (!characterKey) // Make sure we have all slotKeys
      return { split: objectFromKeyMap(allSlotKeys, () => []) as ArtifactsBySlot, totBuildNumber: 0 }
    const artifactDatabase = database._getArts().filter(art => {
      //if its equipped on the selected character, bypass the check
      if (art.location === characterKey) return true

      if (art.exclude && !useExcludedArts) return false
      if (art.location && !useEquippedArts) return false
      return true
    })
    const split = Artifact.splitArtifactsBySlot(artifactDatabase);
    //filter the split slots on the mainstats selected.
    artifactsSlotsToSelectMainStats.forEach(slotKey =>
      mainStatKeys[slotKey].length && (split[slotKey] = split[slotKey]?.filter((art) => mainStatKeys[slotKey].includes(art.mainStatKey))))
    const totBuildNumber = calculateTotalBuildNumber(split, setFilters)
    return artsDirty && { split, totBuildNumber }
  }, [characterKey, useExcludedArts, useEquippedArts, mainStatKeys, setFilters, artsDirty, database])

  const generateBuilds = useCallback(() => {
    if (!initialStats || !artifactSheets) return
    setgeneratingBuilds(true)
    setgenerationDuration(0)
    setgenerationProgress(0)
    setgenerationSkipped(0)
    //get the formula for this target

    const artifactSetEffects = Artifact.setEffectsObjs(artifactSheets, initialStats)
    const splitArtifacts = deepClone(split) as ArtifactsBySlot
    //add mainStatVal to each artifact
    Object.values(splitArtifacts).forEach(artArr => {
      artArr!.forEach(art => {
        art.mainStatVal = Artifact.mainStatValue(art.mainStatKey, art.rarity, Math.max(Math.min(mainStatAssumptionLevel, art.rarity * 4), art.level)) ?? 0;
      })
    })
    //create an obj with app the artifact set effects to pass to buildworker.
    const data = {
      splitArtifacts, initialStats, artifactSetEffects,
      setFilters, minFilters: statFilters, maxBuildsToShow, optimizationTarget
    };
    worker.current?.terminate()
    worker.current = new Worker()
    worker.current.onmessage = (e) => {
      if (typeof e.data.progress === "number") {
        const { progress, timing = 0, skipped = 0 } = e.data
        setgenerationProgress(progress)
        setgenerationDuration(timing)
        setgenerationSkipped(skipped)
        return
      }
      ReactGA.timing({
        category: "Build Generation",
        variable: "timing",
        value: e.data.timing,
        label: totBuildNumber.toString()
      })
      const builds = (e.data.builds as Build[]).map(b => Object.values(b.artifacts).map(a => a.id))
      buildSettingsDispatch({ builds, buildDate: Date.now() })

      setgeneratingBuilds(false)
      worker.current?.terminate()
      worker.current = null
    };
    worker.current.postMessage(data)
  }, [artifactSheets, split, totBuildNumber, mainStatAssumptionLevel, initialStats, maxBuildsToShow, optimizationTarget, setFilters, statFilters, buildSettingsDispatch])


  const dropdownitemsForStar = useCallback((star, index) => artifactSheets && ArtifactSheet.setsWithMaxRarity(artifactSheets, star).map(([setKey, setobj]) => {
    if (setFilters.some(filter => filter.key === setKey)) return false;
    const setsNumArr = Object.keys(artifactSheets?.[setKey]?.setEffects ?? {})
    const artsAccountedOther = setFilters.reduce((accu, cur, ind) => (cur.key && ind !== index) ? accu + cur.num : accu, 0)
    if (setsNumArr.every((num: any) => parseInt(num) + artsAccountedOther > 5)) return false;
    return (<Dropdown.Item key={setKey} onClick={() => buildSettingsDispatch({ type: 'setFilter', index, key: setKey, num: parseInt(setsNumArr[0] as any) ?? 0 })} >
      {setobj.nameWithIcon}
    </Dropdown.Item>)
  }), [setFilters, buildSettingsDispatch, artifactSheets])

  const characterName = characterSheet?.name ?? "Character Name"
  const characterDropDown = useMemo(() => <DropdownButton title={characterName} disabled={generatingBuilds}>
    <Dropdown.Item onClick={() => selectCharacter("")}>Unselect Character</Dropdown.Item>
    <Dropdown.Divider />
    <CharacterSelectionDropdownList onSelect={cKey => selectCharacter(cKey)} />
  </DropdownButton>, [characterName, generatingBuilds, selectCharacter])

  const formula = usePromise(Array.isArray(optimizationTarget) ? Formula.get(optimizationTarget) : undefined, [optimizationTarget])
  const sortByText = useMemo(() => {
    if (Array.isArray(optimizationTarget)) {
      if (!formula) return null
      let [type, , talentKey] = (formula as any).keys as string[]
      const field = (formula as any).field as IFieldDisplay
      const variant = Character.getTalentFieldValue(field, "variant", initialStats)
      const text = Character.getTalentFieldValue(field, "text", initialStats)
      if (type === "character") {
        if (talentKey === "normal" || talentKey === "charged" || talentKey === "plunging") talentKey = "auto"
        return <b>{characterSheet?.getTalentOfKey(talentKey, initialStats?.characterEle)?.name}: <span className={`text-${variant}`}>{text}</span></b>
      } else if (type === "weapon") {
        return <b>{weaponSheet?.name}: <span className={`text-${variant}`}>{text}</span></b>
      }
    } else return <b>Basic Stat: <span className={`text-${Stat.getStatVariant(optimizationTarget)}`}>{Stat.getStatNameWithPercent(optimizationTarget)}</span></b>
    // return <Badge variant="danger">INVALID</Badge>
  }, [optimizationTarget, formula, initialStats, characterSheet, weaponSheet])


  const artsAccounted = setFilters.reduce((accu, cur) => cur.key ? accu + cur.num : accu, 0)
  const artifactCondCount = useMemo(() => {
    let count = 0;
    crawlObject(initialStats?.conditionalValues?.artifact, [], v => Array.isArray(v), () => count++)
    return count
  }, [initialStats?.conditionalValues])
  return <Container className="mt-2"> <buildContext.Provider value={{ equippedBuild: initialStats }}>

    <InfoComponent
      pageKey="buildPage"
      modalTitle="Character Management Page Guide"
      text={["For self-infused attacks, like Noelle's Sweeping Time, enable the skill in the talent page.",
        "You can compare the difference between equipped artifacts and generated builds.",
        "The more complex the formula, the longer the generation time.",]}
    ><InfoDisplay /></InfoComponent>
    <BuildModal {...{
      build: buildStats[modalBuild], showCharacterModal, characterKey, selectCharacter, close: () => {
        setmodalBuild(-1)
        setshowCharacterModal(false)
      }
    }} />
    {!!initialStats && !!characterKey && <ArtConditionalModal {...{ showArtCondModal, setshowArtCondModal, initialStats, characterKey, artifactCondCount }} />}
    <Row className="mt-2 mb-2">
      <Col>
        {/* Build Generator Editor */}
        <Card bg="darkcontent" text={"lightfont" as any}>
          <Card.Header>Build Generator</Card.Header>
          <Card.Body>
            <Row >
              <Col xs={12} lg={6}>
                {/* character selection */}
                {characterKey ?
                  <CharacterCard header={characterDropDown} characterKey={characterKey} bg={"lightcontent"} cardClassName="mb-2" onEdit={!generatingBuilds ? () => setshowCharacterModal(true) : undefined} /> :
                  <Card bg="lightcontent" text={"lightfont" as any} className="mb-2">
                    <Card.Header>
                      {characterDropDown}
                    </Card.Header>
                  </Card>}
                {/* Bonus Stats */}
                {(() => {
                  if (!character) return null
                  const bonusStats = Object.fromEntries(Object.entries(character?.bonusStats).filter(([key]) =>
                    !((key as string).endsWith("enemyImmunity") || (key as string).endsWith("enemyRes_") || key === "enemyLevel")))
                  if (!Object.keys(bonusStats).length) return null
                  const setStatsFields = statsToFields(bonusStats)
                  return < Card bg="lightcontent" text={"lightfont" as any} className="mb-2 w-100" >
                    <Card.Header >Bonus Stats</Card.Header>
                    <Card.Body><ListGroup className="text-white" >
                      {setStatsFields.map((field, i) => <FieldDisplay key={i} index={i} field={field} />)}
                    </ListGroup></Card.Body>
                  </Card>
                })()}
                {/* enemy editor */}
                {!!character && <Accordion >
                  <Card bg="lightcontent" text={"lightfont" as any} className="mb-2">
                    <Card.Header>
                      <Row>
                        <Col>
                          {Stat.getStatName("enemyLevel")} <strong>{Character.getStatValueWithBonus(character, "enemyLevel")}</strong>
                        </Col>
                        <Col xs="auto">
                          <ContextAwareToggle callback={undefined} {...{ as: Button }} eventKey="enemyEditor" />
                        </Col>
                      </Row>
                    </Card.Header>
                    <Card.Body>
                      <Row className="mb-n2">
                        {["physical", ...allElements].map(element => <Col xs={3} key={element}><EnemyResText element={element} character={character} /></Col>)}
                        <Col xs={4} ><span><h6 className={`d-inline`}>DEF Reduction {Character.getStatValueWithBonus(character, "enemyDEFRed_")}%</h6></span></Col>
                      </Row>
                    </Card.Body>
                    <Accordion.Collapse eventKey="enemyEditor">
                      <Card.Body className="p-2">
                        <EnemyEditor character={character} bsProps={{ xs: 12 }} />
                      </Card.Body>
                    </Accordion.Collapse>
                  </Card>
                </Accordion>}
                {/*Minimum Final Stat Filter */}
                {!!statsDisplayKeys && <StatFilterCard className="mb-2" statFilters={statFilters} statKeys={statsDisplayKeys?.basicKeys as any} setStatFilters={sFs => buildSettingsDispatch({ statFilters: sFs })} disabled={generatingBuilds} />}
                {/* Hit mode options */}
                {characterSheet && character && initialStats && <HitModeCard build={initialStats} characterSheet={characterSheet} className="mb-2" character={character} disabled={generatingBuilds} />}
              </Col>
              <Col xs={12} lg={6}><Row>
                <Col className="mb-2" xs={12}>
                  <Card bg="lightcontent" text={"lightfont" as any}><Card.Body>
                    <Button className="w-100" onClick={() => setshowArtCondModal(true)} disabled={generatingBuilds}>
                      <span>Default Artifact Set Effects {Boolean(artifactCondCount) && <Badge variant="success">{artifactCondCount} Selected</Badge>}</span>
                    </Button>
                  </Card.Body></Card>
                </Col>
                {/* Artifact set picker */}
                {(() => {
                  const count = setFilters.filter(s => s.key).length
                  return setFilters.map(({ key: setKey, num: setNum }, index) => index <= count && <Col className="mb-2" key={index} xs={12}>
                    <Card className="h-100" bg="lightcontent" text={"lightfont" as any}>
                      <Card.Header>
                        <ButtonGroup>
                          {/* Artifact set */}
                          <DropdownButton as={ButtonGroup} title={artifactSheets?.[setKey]?.nameWithIcon ?? "Artifact Set Filter"} disabled={generatingBuilds}>
                            <Dropdown.Item onClick={() => buildSettingsDispatch({ type: 'setFilter', index, key: "" })}>Unselect Artifact</Dropdown.Item>
                            <Dropdown.ItemText>Max Rarity 🟊🟊🟊🟊🟊</Dropdown.ItemText>
                            {dropdownitemsForStar(5, index)}
                            <Dropdown.Divider />
                            <Dropdown.ItemText>Max Rarity 🟊🟊🟊🟊</Dropdown.ItemText>
                            {dropdownitemsForStar(4, index)}
                            <Dropdown.Divider />
                            <Dropdown.ItemText>Max Rarity 🟊🟊🟊</Dropdown.ItemText>
                            {dropdownitemsForStar(3, index)}
                          </DropdownButton>
                          {/* set number */}
                          <DropdownButton as={ButtonGroup} title={`${setNum}-set`}
                            disabled={generatingBuilds || !setKey || artsAccounted >= 5}
                          >
                            {!!initialStats && Object.keys(artifactSheets?.[setKey]?.setEffects ?? {}).map((num: any) => {
                              let artsAccountedOther = setFilters.reduce((accu, cur) => (cur.key && cur.key !== setKey) ? accu + cur.num : accu, 0)
                              return (parseInt(num) + artsAccountedOther <= 5) &&
                                (<Dropdown.Item key={num} onClick={() => buildSettingsDispatch({ type: 'setFilter', index, key: setFilters[index].key, num: parseInt(num) })} >
                                  {`${num}-set`}
                                </Dropdown.Item>)
                            })}
                          </DropdownButton>
                        </ButtonGroup>
                      </Card.Header>
                      {setKey ? <Card.Body><Row className="mb-n2">
                        {!!initialStats && !!characterKey && Object.keys(artifactSheets?.[setKey].setEffects ?? {}).map(setNKey => parseInt(setNKey) as SetNum).filter(setNkey => setNkey <= setNum).map(setNumKey =>
                          <SetEffectDisplay newBuild={undefined} key={setKey + setNumKey} {...{ setKey, setNumKey, equippedBuild: initialStats, characterKey, editable: true }} />)}
                      </Row></Card.Body> : null}
                    </Card>
                  </Col>)
                })()}
                <Col className="mb-2" xs={12}>
                  <Card bg="lightcontent" text={"lightfont" as any}><Card.Body className="mb-n2">
                    <Button className="w-100 mb-2" onClick={() => buildSettingsDispatch({ useEquippedArts: !useEquippedArts })} disabled={generatingBuilds}>
                      <span><FontAwesomeIcon icon={useEquippedArts ? faCheckSquare : faSquare} /> Use Equipped Artifacts</span>
                    </Button>
                    <Button className="w-100 mb-2" onClick={() => buildSettingsDispatch({ useExcludedArts: !useExcludedArts })} disabled={generatingBuilds}>
                      <span><FontAwesomeIcon icon={useExcludedArts ? faCheckSquare : faSquare} /> Use Excluded Artifacts</span>
                    </Button>
                  </Card.Body></Card>
                </Col>
                {/* main stat selector */}
                <Col className="mb-2" xs={12}>
                  <Card bg="lightcontent" text={"lightfont" as any}>
                    <Card.Header>
                      <Row>
                        <Col>Artifact Main Stat</Col>
                        <Col xs="auto"><AssumeFullLevelToggle mainStatAssumptionLevel={mainStatAssumptionLevel} setmainStatAssumptionLevel={v => buildSettingsDispatch({ mainStatAssumptionLevel: v })} disabled={generatingBuilds} /></Col>
                      </Row>
                    </Card.Header>
                    <Card.Body className="mb-n2">
                      {artifactsSlotsToSelectMainStats.map(slotKey => {
                        const numSel = mainStatKeys[slotKey].length
                        return <Card bg="darkcontent" text={"lightfont" as any} className="mb-2" key={slotKey}>
                          <Card.Header className="p-2"><Row >
                            <Col className="ml-2"><SlotNameWithIcon slotKey={slotKey} /></Col>
                            <Col xs="auto">
                              <Badge variant="info">{numSel ? `${numSel} Selected` : `Any`}</Badge>
                              <Button variant="danger" size="sm" className="py-0 px-1 ml-2" disabled={!mainStatKeys[slotKey].length}
                                onClick={() => buildSettingsDispatch({ type: "mainStatKeyReset", slotKey })}>
                                <FontAwesomeIcon icon={faUndo} />
                              </Button>
                            </Col>
                          </Row></Card.Header>
                          <Card.Body className="p-0"><Row className="no-gutters">
                            {Artifact.slotMainStats(slotKey).map((mainStatKey, i) => {
                              const selected = mainStatKeys[slotKey].includes(mainStatKey)
                              return <Col xs={i < 3 ? 4 : 6} key={mainStatKey}>
                                <Button className="w-100 rounded-0" size="sm" variant={selected ? "success" : "secondary"} disabled={generatingBuilds}
                                  onClick={() => buildSettingsDispatch({ type: "mainStatKey", slotKey, mainStatKey })}>
                                  {StatIcon[mainStatKey]} {Stat.getStatNameWithPercent(mainStatKey, "", false)}
                                </Button>
                              </Col>
                            })}
                          </Row></Card.Body>
                        </Card>
                      })}
                    </Card.Body>
                  </Card>
                </Col>
              </Row></Col>
            </Row>
            <Row className="d-flex justify-content-between mb-2">
              <Col xs="auto" >
                <ButtonGroup>
                  <Button
                    className="h-100"
                    disabled={!characterKey || generatingBuilds}
                    variant={(characterKey && totBuildNumber <= warningBuildNumber) ? "success" : "warning"}
                    onClick={generateBuilds}
                  ><span>Generate</span></Button>
                  <Dropdown as={ButtonGroup}>
                    <OverlayTrigger
                      overlay={<Tooltip id="max-build-tooltip">
                        Decreasing the number of generated build will decrease build calculation time for large number of builds.
                      </Tooltip>}
                    >
                      <Dropdown.Toggle disabled={generatingBuilds}><b>{maxBuildsToShow}</b> {maxBuildsToShow === 1 ? "Build" : "Builds"}</Dropdown.Toggle>
                    </OverlayTrigger>
                    <Dropdown.Menu>
                      {maxBuildsToShowList.map(v => <Dropdown.Item key={v} onClick={() => buildSettingsDispatch({ maxBuildsToShow: v })}>{v} {v === 1 ? "Build" : "Builds"}</Dropdown.Item>)}
                    </Dropdown.Menu>
                  </Dropdown>
                  <Button
                    className="h-100"
                    disabled={!generatingBuilds}
                    variant="danger"
                    onClick={() => {
                      if (!worker.current) return;
                      worker.current.terminate();
                      worker.current = null
                      setgeneratingBuilds(false)
                      setgenerationDuration(0)
                      setgenerationProgress(0)
                      setgenerationSkipped(0)
                    }}
                  ><span>Cancel</span></Button>
                </ButtonGroup>
              </Col>
              <Col xs="auto">
                {/* Dropdown to select sorting value */}
                {<Dropdown as={ButtonGroup} drop="up">
                  <Dropdown.Toggle disabled={generatingBuilds} variant="light" >
                    <span>Optimization Target: {sortByText}</span>
                  </Dropdown.Toggle>
                  <Dropdown.Menu align="right" style={{ minWidth: "40rem" }} >
                    <Row>
                      {!!statsDisplayKeys && Object.entries(statsDisplayKeys).map(([sectionKey, fields]: [string, any]) => {
                        const header = (characterSheet && weaponSheet && artifactSheets) ? getFormulaTargetsDisplayHeading(sectionKey, { characterSheet, weaponSheet, artifactSheets }, initialStats?.characterEle) : sectionKey
                        return <Col xs={12} md={6} key={sectionKey}>
                          <Dropdown.Header style={{ overflow: "hidden", textOverflow: "ellipsis" }}><b>{header}</b></Dropdown.Header>
                          {fields.map((target, i) => {
                            if (Array.isArray(target))
                              return <TargetSelectorDropdownItem key={i} {...{ target, buildSettingsDispatch, initialStats }} />
                            else if (typeof target === "string")
                              return <Dropdown.Item key={i} onClick={() => buildSettingsDispatch({ optimizationTarget: target })}>{Stat.getStatNameWithPercent(target)}</Dropdown.Item>
                            return null
                          })}
                        </Col>
                      })}
                    </Row>
                  </Dropdown.Menu>
                </Dropdown>}
              </Col>
            </Row>
            <Row className="">
              <Col>{!!characterKey && <BuildAlert {...{ totBuildNumber, generatingBuilds, generationSkipped, generationProgress, generationDuration, characterName, maxBuildsToShow }} />}</Col>
            </Row>
          </Card.Body>
        </Card>
      </Col>
    </Row>
    <Row className="mb-2">
      <Col>
        <Card bg="darkcontent" text={"lightfont" as any}>
          <Card.Header>
            <Row>
              <Col>{buildStats ? <span>Showing <strong>{buildStats.length}</strong> Builds generated for {characterName}. {!!buildDate && <span>Build generated on: <strong>{(new Date(buildDate)).toLocaleString()}</strong></span>}</span>
                : <span>Select a character to generate builds.</span>}</Col>
            </Row>
          </Card.Header>
          {/* Build List */}
          <ListGroup>
            {buildStats?.map((build, index) =>
              characterSheet && weaponSheet && artifactSheets && <ArtifactDisplayItem sheets={{ characterSheet, weaponSheet, artifactSheets }} build={build} characterKey={characterKey as CharacterKey} index={index} key={index} statsDisplayKeys={statsDisplayKeys} onClick={() => setmodalBuild(index)} />
            )}
          </ListGroup>
        </Card>
      </Col>
    </Row>
  </buildContext.Provider></Container >
}

function TargetSelectorDropdownItem({ target, buildSettingsDispatch, initialStats }) {
  const formula = usePromise(Formula.get(target), [target])
  if (!formula) return null
  const talentField = (formula as any).field as IFieldDisplay
  return <Dropdown.Item onClick={() => buildSettingsDispatch({ optimizationTarget: target })} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
    <span className={`text-${Character.getTalentFieldValue(talentField, "variant", initialStats)}`}>{Character.getTalentFieldValue(talentField, "text", initialStats)}</span>
  </Dropdown.Item>
}

function BuildModal({ build, showCharacterModal, characterKey, selectCharacter, close }) {
  return <Modal show={Boolean(showCharacterModal || build)} onHide={close} size="xl" contentClassName="bg-transparent">
    <React.Suspense fallback={<span>Loading...</span>}>
      <CharacterDisplayCard
        tabName={undefined}
        characterKey={characterKey}
        setCharacterKey={cKey => selectCharacter(cKey)}
        newBuild={build}
        onClose={close}
        footer={<Button variant="danger" onClick={close}>Close</Button>} />
    </React.Suspense>
  </Modal>
}

function ArtConditionalModal({ showArtCondModal, setshowArtCondModal, initialStats, characterKey, artifactCondCount }: {
  showArtCondModal, setshowArtCondModal, initialStats: ICalculatedStats, characterKey: CharacterKey, artifactCondCount
}) {
  const closeArtCondModal = useCallback(() => setshowArtCondModal(false), [setshowArtCondModal])
  const artifactSheets = usePromise(ArtifactSheet.getAll(), [])
  const characterDispatch = useCharacterReducer(characterKey)
  if (!artifactSheets) return null
  const artSetKeyList = Object.entries(ArtifactSheet.setKeysByRarities(artifactSheets)).reverse().flatMap(([, sets]) => sets)
  return <Modal show={showArtCondModal} onHide={closeArtCondModal} size="xl" contentClassName="bg-transparent">
    <Card bg="darkcontent" text={"lightfont" as any}>
      <Card.Header>
        <Row>
          <Col>
            <h5>Default Artifact Set Effects  {Boolean(artifactCondCount) && <Badge variant="success">{artifactCondCount} Selected</Badge>}</h5>
          </Col>
          <Col xs="auto" >
            <Button onClick={() => {
              if (initialStats.conditionalValues.artifact) initialStats.conditionalValues.artifact = {}
              characterDispatch({ conditionalValues: initialStats.conditionalValues })
            }}><span><FontAwesomeIcon icon={faUndo} /> Reset All</span></Button>
          </Col>
          <Col xs="auto" >
            <Button variant="danger" onClick={closeArtCondModal}>
              <FontAwesomeIcon icon={faTimes} /></Button>
          </Col>
        </Row>
      </Card.Header>
      <Card.Body>
        <Row>
          {artSetKeyList.map(setKey => {
            const sheet = artifactSheets[setKey]
            let icon = Object.values(sheet.slotIcons)[0]
            const rarities = sheet.rarity
            const rarity = rarities[0]
            return <Col className="mb-2" key={setKey} xs={12} lg={6} xl={4}>
              <Card className="h-100" bg="lightcontent" text={"lightfont" as any}>
                <Card.Header >
                  <Row>
                    <Col xs="auto" className="ml-n3 my-n2">
                      <Image src={icon} className={`thumb-mid grad-${rarity}star m-1`} thumbnail />
                    </Col>
                    <Col >
                      <h6><b>{artifactSheets?.[setKey].name ?? ""}</b></h6>
                      <span>{rarities.map((ns, i) => <span key={ns}>{ns}<Stars stars={1} /> {i < (rarities.length - 1) ? "/ " : null}</span>)}</span>
                    </Col>
                  </Row>
                </Card.Header>
                <Card.Body><Row className="mb-n2">
                  {Boolean(setKey) && Object.keys(sheet.setEffects).map(key => parseInt(key) as SetNum).map(setNumKey =>
                    <SetEffectDisplay newBuild={undefined} key={setKey + setNumKey} {...{ setKey, setNumKey, equippedBuild: initialStats, editable: true, characterKey }} />)}
                </Row></Card.Body>
              </Card>
            </Col>
          })}
        </Row>
      </Card.Body>
      <Card.Footer>
        <Button variant="danger" onClick={closeArtCondModal}>
          <FontAwesomeIcon icon={faTimes} /> CLOSE</Button>
      </Card.Footer>
    </Card>
  </Modal>
}

function StatFilterItem({ statKey, statKeys = [], min, close, setFilter, disabled }: {
  statKey?, statKeys, min, close, setFilter, disabled
}) {
  const isFloat = Stat.getStatUnit(statKey) === "%"
  const inputProps = {
    disabled: !statKey,
    allowEmpty: true,
    float: isFloat,
  }
  const minInputProps = {
    ...inputProps,
    placeholder: "MIN",
    value: min,
    onChange: (s) => setFilter(statKey, s)
  }
  return <InputGroup className="mb-2">
    <DropdownButton
      as={InputGroup.Prepend}
      title={Stat.getStatNameWithPercent(statKey, "New Stat")}
      id="input-group-dropdown-1"
      disabled={disabled}
    >
      {statKeys.map(sKey => <Dropdown.Item key={sKey} onClick={() => { close?.(); setFilter(sKey, min) }}>{Stat.getStatNameWithPercent(sKey)}</Dropdown.Item>)}
    </DropdownButton>
    <CustomFormControl {...minInputProps} />
    {Boolean(close) && <InputGroup.Append>
      <Button variant="danger" onClick={close} disabled={disabled}><FontAwesomeIcon icon={faTrash} /></Button>
    </InputGroup.Append>}
  </InputGroup>
}

function HitModeCard({ characterSheet, character, character: { key: characterKey }, build, className, disabled }: { characterSheet: CharacterSheet, character: ICachedCharacter, build: ICalculatedStats, className: string, disabled: boolean }) {
  if (!character) return null
  return <Card bg="lightcontent" text={"lightfont" as any} className={className}>
    <Card.Header>
      <Row>
        <Col>Hit Mode Options</Col>
        <Col xs="auto"><InfusionAuraDropdown characterSheet={characterSheet} character={character} disabled={disabled} /></Col>
      </Row>
    </Card.Header>
    <Card.Body className="mb-n2">
      <HitModeToggle characterKey={characterKey} hitMode={character.hitMode} className="w-100 mb-2" disabled={disabled} />
      <ReactionToggle build={build} character={character} className="w-100 mb-2" disabled={disabled} />
    </Card.Body>
  </Card >
}

function StatFilterCard({ statKeys = [], statFilters = {}, setStatFilters, className, disabled }: { statKeys: StatKey[], statFilters: Dict<StatKey, number>, setStatFilters: (object) => void, className: string, disabled?: boolean }) {
  const remainingKeys = statKeys.filter(key => !(Object.keys(statFilters) as any).some(k => k === key))
  const setFilter = (sKey, min) => setStatFilters({ ...statFilters, [sKey]: min })
  return <Card bg="lightcontent" text={"lightfont" as any} className={className}>
    <Card.Header>Minimum Final Stat Filter</Card.Header>
    <Card.Body>
      <Row className="mb-n2">
        {Object.entries(statFilters).map(([statKey, min]) => {
          return <Col xs={12} key={statKey} ><StatFilterItem statKey={statKey} statKeys={remainingKeys} setFilter={setFilter} disabled={disabled} min={min} close={() => {
            delete statFilters[statKey]
            setStatFilters({ ...statFilters })
          }} /></Col>
        })}
        <Col xs={12}>
          <StatFilterItem min={undefined} close={undefined} statKeys={remainingKeys} setFilter={setFilter} disabled={disabled} />
        </Col>
      </Row>
    </Card.Body>
  </Card>
}

type ArtifactDisplayItemProps = {
  sheets: {
    characterSheet: CharacterSheet
    weaponSheet: WeaponSheet,
    artifactSheets: StrictDict<ArtifactSetKey, ArtifactSheet>
  },
  index: number,
  characterKey: CharacterKey,
  build: ICalculatedStats,
  statsDisplayKeys: any,
  onClick: () => void
}
//for displaying each artifact build
function ArtifactDisplayItem({ sheets, sheets: { artifactSheets }, index, characterKey, build, statsDisplayKeys, onClick }: ArtifactDisplayItemProps) {
  const database = useContext(DatabaseContext)
  const character = database._getChar(characterKey)
  if (!character) return null
  const { equippedArtifacts } = character
  const currentlyEquipped = allSlotKeys.every(slotKey => equippedArtifacts[slotKey] === build.equippedArtifacts?.[slotKey])
  return (<div>
    <ListGroup.Item
      variant={index % 2 ? "customdark" : "customdarker"} className="text-white" action
      onClick={onClick}
    >
      <h5 className="mb-2"><Row>
        <Col xs="auto">
          <Badge variant="info"><strong>{index + 1}{currentlyEquipped ? " (Equipped)" : ""}</strong></Badge>
        </Col>
        <Col xs="auto">{(Object.entries(build.setToSlots) as [ArtifactSetKey, SlotKey[]][]).sort(([key1, slotarr1], [key2, slotarr2]) => slotarr2.length - slotarr1.length).map(([key, slotarr]) =>
          <Badge key={key} variant={currentlyEquipped ? "success" : "primary"} className="mr-2">
            {slotarr.map(slotKey => artifactSlotIcon(slotKey))} {artifactSheets?.[key].name ?? ""}
          </Badge>
        )}</Col>
      </Row></h5>
      <StatDisplayComponent {...{ sheets, character, equippedBuild: build, statsDisplayKeys, cardbg: (index % 2 ? "lightcontent" : "darkcontent") }} />
    </ListGroup.Item>
  </div>)
}

function BuildAlert({ totBuildNumber, generatingBuilds, generationSkipped, generationProgress, generationDuration, characterName, maxBuildsToShow }) {
  const totalBuildNumberString = totBuildNumber?.toLocaleString() ?? totBuildNumber
  const totalUnskipped = totBuildNumber - generationSkipped
  const generationProgressString = generationProgress?.toLocaleString() ?? generationProgress
  const generationSkippedString = generationSkipped?.toLocaleString() ?? generationSkipped
  const totalUnskippedString = totalUnskipped?.toLocaleString() ?? totalUnskipped
  const generationSkippedText = Boolean(generationSkipped) && <span>(<b>{generationSkippedString}</b> skipped)</span>
  if (generatingBuilds) {
    let progPercent = generationProgress * 100 / (totalUnskipped)
    return <Alert variant="success">
      <span>Generating and testing <b className="text-monospace">{generationProgressString}/{totalUnskippedString}</b> build configurations against the criteria for <b>{characterName}</b>. {generationSkippedText}</span><br />
      <h6>Time elapsed: <strong className="text-monospace">{timeStringMs(generationDuration)}</strong></h6>
      <ProgressBar now={progPercent} label={`${progPercent.toFixed(1)}%`} />
    </Alert>
  } else if (!generatingBuilds && generationProgress) {//done
    return <Alert variant="success">
      <span>Generated and tested <b className="text-monospace">{totalUnskippedString}</b> Build configurations against the criteria for <b>{characterName}</b>. {generationSkippedText}</span>
      <h6>Total duration: <strong className="text-monospace">{timeStringMs(generationDuration)}</strong></h6>
      <ProgressBar now={100} variant="success" label="100%" />
    </Alert>
  } else {
    return totBuildNumber === 0 ?
      <Alert variant="warning" className="mb-0"><span>Current configuration will not generate any builds for <b>{characterName}</b>. Please change your Artifact configurations, or add/include more Artifacts.</span></Alert>
      : (totBuildNumber > warningBuildNumber ?
        <Alert variant="warning" className="mb-0"><span>Current configuration will generate <b>{totalBuildNumberString}</b> builds for <b>{characterName}</b>. This might take quite a while to generate...</span></Alert> :
        <Alert variant="success" className="mb-0"><span>Current configuration {totBuildNumber <= maxBuildsToShow ? "generated" : "will generate"} <b>{totalBuildNumberString}</b> builds for <b>{characterName}</b>.</span></Alert>)
  }
}

const levels = {
  0: <span>No level assumption</span>,
  4: <span>Assume at least level 4</span>,
  8: <span>Assume at least level 8</span>,
  12: <span>Assume at least level 12</span>,
  16: <span>Assume at least level 16</span>,
  20: <span>Assume at least level 20</span>
}
function AssumeFullLevelToggle({ mainStatAssumptionLevel = 0, setmainStatAssumptionLevel, disabled }) {
  return <OverlayTrigger overlay={<Tooltip id="assume-level-tooltip">Change Main Stat value to be at least a specific level. Does not change substats.</Tooltip>} >
    <Dropdown>
      <Dropdown.Toggle variant={mainStatAssumptionLevel ? "orange" : "primary"} disabled={disabled}>{levels[mainStatAssumptionLevel]}</Dropdown.Toggle>
      <Dropdown.Menu>
        {Object.entries(levels).map(([key, text]) => <Dropdown.Item key={key} onClick={() => setmainStatAssumptionLevel(parseInt(key))}>{text}</Dropdown.Item>)}
      </Dropdown.Menu>
    </Dropdown>
  </OverlayTrigger>
}
