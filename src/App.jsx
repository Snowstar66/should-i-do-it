import { useState, useEffect } from 'react'

function App() {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [questionType, setQuestionType] = useState('general')
  const [weight, setWeight] = useState('')
  const [height, setHeight] = useState('')
  const [bmi, setBmi] = useState('')
  const [bmiClassification, setBmiClassification] = useState('')
  const [birthYear, setBirthYear] = useState('')
  const [age, setAge] = useState('')
  const [loading, setLoading] = useState(false)
  const [dateTime, setDateTime] = useState(new Date())
  const [dogFallen, setDogFallen] = useState(false)
  const [showInfo, setShowInfo] = useState(false)

  const playDogWail = () => {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)()
      const oscillator = audioContext.createOscillator()
      const gainNode = audioContext.createGain()
      
      oscillator.connect(gainNode)
      gainNode.connect(audioContext.destination)
      
      // Create a wailing sound - starts high and goes low
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(800, audioContext.currentTime)
      oscillator.frequency.exponentialRampToValueAtTime(200, audioContext.currentTime + 2)
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 2)
      
      oscillator.start(audioContext.currentTime)
      oscillator.stop(audioContext.currentTime + 2)
    } catch (e) {
      // Audio not supported, silently fail
    }
  }

  useEffect(() => {
    const timer = setInterval(() => {
      setDateTime(new Date())
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const calculateBMI = () => {
    if (!weight || !height) {
      alert("Vänligen fyll i både vikt och längd")
      return
    }
    const heightInMeters = height / 100
    const bmiValue = weight / (heightInMeters * heightInMeters)
    setBmi(bmiValue.toFixed(1))
    
    let classification = ''
    if (bmiValue < 18.5) {
      classification = 'Underviktig'
    } else if (bmiValue >= 18.5 && bmiValue < 25) {
      classification = 'Normalviktig'
    } else if (bmiValue >= 25 && bmiValue < 30) {
      classification = 'Överviktig'
    } else {
      classification = 'Fet'
    }
    setBmiClassification(classification)
  }

  const calculateAge = () => {
    if (!birthYear) {
      alert("Vänligen ange födelseår")
      return
    }
    const currentYear = new Date().getFullYear()
    const ageValue = currentYear - parseInt(birthYear)
    setAge(ageValue)
  }

  const fetchAnswerFromInternet = async () => {
    try {
      setLoading(true)
      const encodedQuestion = encodeURIComponent(question)
      
      // Try Wikipedia API first - more reliable for factual questions
      const searchResponse = await fetch(`https://sv.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodedQuestion}&format=json&origin=*`)
      const searchData = await searchResponse.json()
      
      if (searchData.query && searchData.query.search && searchData.query.search.length > 0) {
        const pageTitle = searchData.query.search[0].title
        
        // Get the page content
        const contentResponse = await fetch(`https://sv.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(pageTitle)}&prop=extracts&exintro=true&explaintext=true&format=json&origin=*`)
        const contentData = await contentResponse.json()
        
        const pages = contentData.query.pages
        if (pages) {
          const page = Object.values(pages)[0]
          if (page.extract) {
            const cleanText = page.extract.substring(0, 600).trim()
            setAnswer(cleanText + '\n\n— Källa: Wikipedia')
            setLoading(false)
            return
          }
        }
      }
      
      // Fallback: Try DuckDuckGo
      const duckResponse = await fetch(`https://api.duckduckgo.com/?q=${encodedQuestion}&format=json`)
      const duckData = await duckResponse.json()
      
      if (duckData.AbstractText && duckData.AbstractText.length > 0) {
        setAnswer(duckData.AbstractText)
        setLoading(false)
        return
      }
      
      // If nothing found
      setAnswer('Kunde inte hitta ett svar. Försök med en annan fråga eller formulering.')
      setLoading(false)
    } catch (error) {
      console.error('Error fetching answer:', error)
      setAnswer('Något gick fel vid hämtning av svar. Försök igen senare.')
      setLoading(false)
    }
  }

  const handleClick = () => {
    if (questionType === 'bmi') {
      calculateBMI()
      return
    }

    if (questionType === 'age') {
      calculateAge()
      return
    }

    if (!question) {
      setAnswer("Skriv en fråga först 🙂")
      return
    }

    fetchAnswerFromInternet()
  }

  const isBmiQuestion = questionType === 'bmi'
  const isAgeQuestion = questionType === 'age'

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'space-between',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      padding: '20px',
      paddingTop: '40px',
      paddingBottom: '40px'
    }}>
      <style>{`
        @keyframes walkDog {
          0%, 100% {
            transform: translateX(-40px) scaleX(-1);
          }
          50% {
            transform: translateX(40px) scaleX(-1);
          }
        }
        
        @keyframes fallDog {
          0% {
            transform: rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(calc(100vh - 260px)) rotate(180deg);
            opacity: 1;
          }
        }
        
        .walking-dog {
          animation: walkDog 2s ease-in-out infinite;
        }
        
        .fallen-dog {
          animation: fallDog 4s ease-in forwards;
          position: absolute;
          z-index: 1000;
          left: 50%;
          margin-left: -30px;
          top: 0;
        }
      `}</style>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
        <div style={{ fontSize: '60px', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80px', position: 'relative' }}>
          {!dogFallen ? (
            <div className="walking-dog" onClick={() => { setDogFallen(true); playDogWail(); }} style={{ cursor: 'pointer' }}>🐩</div>
          ) : (
            <div className="fallen-dog">🐩</div>
          )}
        </div>
        <div style={{
          background: 'white',
          borderRadius: '20px',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
          padding: '50px',
          maxWidth: '500px',
          width: '100%',
          position: 'relative'
        }}>
        <div style={{ position: 'absolute', top: '15px', right: '15px', display: 'flex', gap: '10px' }}>
          <button
            onClick={() => setShowInfo(!showInfo)}
            style={{
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              border: 'none',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              color: 'white',
              transition: 'all 0.3s ease',
              boxShadow: '0 4px 12px rgba(102, 126, 234, 0.3)',
              padding: '0'
            }}
            onMouseOver={(e) => {
              e.target.style.boxShadow = '0 6px 16px rgba(102, 126, 234, 0.5)'
              e.target.style.transform = 'scale(1.1)'
            }}
            onMouseOut={(e) => {
              e.target.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.3)'
              e.target.style.transform = 'scale(1)'
            }}
            title="Information"
          >
            ⓘ
          </button>
          <button
            onClick={() => {
              setQuestion('')
              setAnswer('')
              setQuestionType('general')
              setWeight('')
              setHeight('')
              setBmi('')
              setBmiClassification('')
              setBirthYear('')
              setAge('')
              setLoading(false)
              setDogFallen(false)
            }}
            style={{
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              border: 'none',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              color: 'white',
              transition: 'all 0.3s ease',
              boxShadow: '0 4px 12px rgba(102, 126, 234, 0.3)',
              padding: '0'
            }}
            onMouseOver={(e) => {
              e.target.style.boxShadow = '0 6px 16px rgba(102, 126, 234, 0.5)'
              e.target.style.transform = 'rotate(180deg) scale(1.1)'
            }}
            onMouseOut={(e) => {
              e.target.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.3)'
              e.target.style.transform = 'rotate(0deg) scale(1)'
            }}
            title="Nollställ allt"
          >
            ⟲
          </button>
        </div>
        <h1 style={{
          fontSize: '32px',
          fontWeight: '700',
          color: '#222',
          marginBottom: '30px',
          margin: '0 0 30px 0'
        }}>Fråga något du vill veta</h1>

        <div style={{
          background: '#f8f9ff',
          borderRadius: '12px',
          padding: '15px',
          marginBottom: '20px'
        }}>
          <p style={{ fontSize: '14px', fontWeight: '600', color: '#555', margin: '0 0 12px 0' }}>Typ av fråga:</p>
          <div style={{ display: 'flex', gap: '15px' }}>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="radio"
                name="questionType"
                value="general"
                checked={questionType === 'general'}
                onChange={(e) => {
                  setQuestionType(e.target.value)
                  setAnswer('')
                  setQuestion('')
                  setWeight('')
                  setHeight('')
                  setBmi('')
                  setBmiClassification('')
                  setBirthYear('')
                  setAge('')
                  setDogFallen(false)
                }}
                style={{ cursor: 'pointer', marginRight: '6px' }}
              />
              <span style={{ fontSize: '14px', color: '#555' }}>Generell</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="radio"
                name="questionType"
                value="bmi"
                checked={questionType === 'bmi'}
                onChange={(e) => {
                  setQuestionType(e.target.value)
                  setAnswer('')
                  setQuestion('')
                  setWeight('')
                  setHeight('')
                  setBmi('')
                  setBmiClassification('')
                  setBirthYear('')
                  setAge('')
                  setDogFallen(false)
                }}
                style={{ cursor: 'pointer', marginRight: '6px' }}
              />
              <span style={{ fontSize: '14px', color: '#555' }}>BMI</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="radio"
                name="questionType"
                value="age"
                checked={questionType === 'age'}
                onChange={(e) => {
                  setQuestionType(e.target.value)
                  setAnswer('')
                  setQuestion('')
                  setWeight('')
                  setHeight('')
                  setBmi('')
                  setBmiClassification('')
                  setBirthYear('')
                  setDogFallen(false)
                  setAge('')
                }}
                style={{ cursor: 'pointer', marginRight: '6px' }}
              />
              <span style={{ fontSize: '14px', color: '#555' }}>Ålder</span>
            </label>
          </div>
        </div>

        {questionType === 'general' && (
        <input
          type="text"
          placeholder="Skriv din fråga..."
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value)
            setAnswer('')
            setWeight('')
            setHeight('')
            setBmi('')
            setBmiClassification('')
            setBirthYear('')
            setAge('')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleClick()
            }
          }}
          style={{
            width: '100%',
            padding: '14px 16px',
            fontSize: '16px',
            border: '2px solid #e0e0e0',
            borderRadius: '12px',
            boxSizing: 'border-box',
            transition: 'all 0.3s ease',
            outline: 'none',
            marginBottom: '20px'
          }}
          onFocus={(e) => e.target.style.borderColor = '#667eea'}
          onBlur={(e) => e.target.style.borderColor = '#e0e0e0'}
        />
        )}

        <button
          onClick={handleClick}
          disabled={loading}
          style={{
            width: '100%',
            padding: '14px 24px',
            fontSize: '16px',
            fontWeight: '600',
            color: 'white',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            border: 'none',
            borderRadius: '12px',
            cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'all 0.3s ease',
            boxShadow: '0 4px 15px rgba(102, 126, 234, 0.4)',
            marginBottom: '25px',
            opacity: loading ? 0.7 : 1
          }}
          onMouseOver={(e) => {
            if (!loading) {
              e.target.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.6)'
              e.target.style.transform = 'translateY(-2px)'
            }
          }}
          onMouseOut={(e) => {
            e.target.style.boxShadow = '0 4px 15px rgba(102, 126, 234, 0.4)'
            e.target.style.transform = 'translateY(0)'
          }}
        >
          {loading ? 'Laddar...' : questionType === 'bmi' ? 'Beräkna BMI' : questionType === 'age' ? 'Beräkna ålder' : 'Få svar'}
        </button>

        {isBmiQuestion && (
          <div style={{
            background: '#f8f9ff',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '20px'
          }}>
            <div style={{ marginBottom: '15px' }}>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '600',
                color: '#555',
                marginBottom: '8px'
              }}>Weight (kg)</label>
              <input
                type="number"
                value={weight}
                onChange={(e) => setWeight(e.target.value === '' ? '' : parseFloat(e.target.value))}
                placeholder="Enter weight"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: '14px',
                  border: '2px solid #e0e0e0',
                  borderRadius: '8px',
                  boxSizing: 'border-box',
                  outline: 'none'
                }}
              />
            </div>
            <div>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '600',
                color: '#555',
                marginBottom: '8px'
              }}>Height (cm)</label>
              <input
                type="number"
                value={height}
                onChange={(e) => setHeight(e.target.value === '' ? '' : parseFloat(e.target.value))}
                placeholder="Enter height"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: '14px',
                  border: '2px solid #e0e0e0',
                  borderRadius: '8px',
                  boxSizing: 'border-box',
                  outline: 'none'
                }}
              />
            </div>
            {bmi && (
              <div style={{
                marginTop: '15px',
                padding: '15px',
                background: 'white',
                borderRadius: '8px',
                textAlign: 'center'
              }}>
                <p style={{ color: '#888', fontSize: '12px', margin: '0 0 5px 0' }}>Your BMI</p>
                <h2 style={{ color: '#667eea', fontSize: '36px', fontWeight: '700', margin: '0 0 10px 0' }}>{bmi}</h2>
                <p style={{ color: '#764ba2', fontSize: '14px', fontWeight: '600', margin: '0' }}>{bmiClassification}</p>
              </div>
            )}
          </div>
        )}

        {isAgeQuestion && (
          <div style={{
            background: '#f8f9ff',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '20px'
          }}>
            <label style={{
              display: 'block',
              fontSize: '14px',
              fontWeight: '600',
              color: '#555',
              marginBottom: '8px'
            }}>Birth Year</label>
            <input
              type="number"
              value={birthYear}
              onChange={(e) => setBirthYear(e.target.value)}
              placeholder="Enter birth year"
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
                border: '2px solid #e0e0e0',
                borderRadius: '8px',
                boxSizing: 'border-box',
                outline: 'none',
                marginBottom: '15px'
              }}
            />
            {age && (
              <div style={{
                padding: '15px',
                background: 'white',
                borderRadius: '8px',
                textAlign: 'center'
              }}>
                <p style={{ color: '#888', fontSize: '12px', margin: '0 0 5px 0' }}>Your Age</p>
                <h2 style={{ color: '#667eea', fontSize: '36px', fontWeight: '700', margin: '0' }}>{age}</h2>
              </div>
            )}
          </div>
        )}

        {!isBmiQuestion && !isAgeQuestion && answer && (
          <div style={{
            background: '#f8f9ff',
            borderRadius: '12px',
            padding: '25px',
            border: '1px solid #e0e0f0',
            borderLeft: '5px solid #667eea'
          }}>
            <p style={{
              fontSize: '16px',
              lineHeight: '1.8',
              color: '#333',
              margin: '0',
              fontWeight: '400',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}>
              {answer}
            </p>
          </div>
        )}
      </div>

      {showInfo && (
        <div onClick={() => setShowInfo(false)} style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2000,
          cursor: 'pointer',
          padding: '20px'
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: 'white',
            borderRadius: '20px',
            boxShadow: '0 30px 90px rgba(0, 0, 0, 0.4)',
            padding: '40px',
            maxWidth: '600px',
            width: '100%',
            maxHeight: '85vh',
            overflowY: 'auto',
            cursor: 'default'
          }}>
            <div style={{ textAlign: 'center', marginBottom: '30px' }}>
              <p style={{
                fontSize: '28px',
                fontWeight: '700',
                color: '#667eea',
                margin: '0 0 10px 0'
              }}>🎨 Pontus the Great</p>
              <p style={{
                fontSize: '16px',
                fontWeight: '600',
                color: '#764ba2',
                margin: '0'
              }}>AI Master Architect</p>
              <p style={{
                fontSize: '13px',
                color: '#888',
                marginTop: '8px',
                fontStyle: 'italic'
              }}>Designer av denna applikation</p>
            </div>

            <div style={{
              borderTop: '2px solid #f0f0f0',
              paddingTop: '25px'
            }}>
              <h3 style={{
                fontSize: '18px',
                fontWeight: '700',
                color: '#333',
                marginBottom: '15px'
              }}>🛠️ Teknik & Komponenter</h3>
              
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
                fontSize: '13px',
                lineHeight: '1.6'
              }}>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>React</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>UI-bibliotek för komponent-baserad arkitektur</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>React Hooks</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>useState och useEffect för state-management</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>JSX</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Syntaktisk extension för HTML i JavaScript</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>JavaScript ES6+</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Modern JavaScript med arrows, async/await</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>CSS3 Animations</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>@keyframes för smooth visuell rörelse</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>CSS Gradients</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Linear gradients för visuell stil</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>Flexbox & CSS Grid</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Layout-system för responsiv design</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>Web Audio API</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Skapar ljud-effekter programmatiskt</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>Fetch API</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Asynkrona HTTP-förfrågningar från internet</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>Wikipedia API</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Hämtar faktabaserad data från Wikipedia</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>DuckDuckGo API</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Fallback sökmotorsdata vid brister</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>Node.js</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>JavaScript runtime-miljö</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>npm</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Package manager för JavaScript</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>Vite</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Build tool för snabb utveckling</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>ESLint</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Kodkvalité och linting av JavaScript</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>VS Code</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Utvecklingsmiljö för kodning</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>DOM API</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Manipulering av HTML-element</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>Event Handling</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>onClick, onKeyDown, onMouseOver etc</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>Async/Await</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Asynkron programmering för API-anrop</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>JSON</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Data-format från API-svar</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>Template Literals</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Backtick-strings för dynamisk text</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>Arrow Functions</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>{'(=>)'} Moderne funktionssyntax</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>State Management</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Hantering av komponent-tillstånd</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>Side Effects</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>useEffect för data-hämtning</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>Conditional Rendering</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Visa/göm UI baserat på state</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>CSS Transforms</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>translateX, translateY, rotate, scale</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>CSS Box Model</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Padding, margin, border, shadow</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>Responsive Design</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>mobil-anpassad layout</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>Z-Index & Stacking</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Lagring av element i 3D-perspektiv</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>Position (Absolute/Fixed)</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Precis placering av element</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>String Interpolation</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Dynamisk strängkonstruktion</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>Input Validation</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Kontroll av användarinmatning</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>Date Object</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Hantering av datum och tid</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>Locale Formatting</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>toLocaleTimeString, toLocaleDateString</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>setInterval/clearInterval</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Repeterad exekvering av kod</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>CORS</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Cross-Origin Resource Sharing</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>Error Handling</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Try-catch och fallback-mekanismer</p>
                </div>
                <div style={{
                  background: '#f8f9ff',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #667eea'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#667eea' }}>Closures</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Funktioner som lagrar scope</p>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowInfo(false)}
              style={{
                width: '100%',
                marginTop: '25px',
                padding: '12px 24px',
                fontSize: '14px',
                fontWeight: '600',
                color: 'white',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                border: 'none',
                borderRadius: '12px',
                cursor: 'pointer',
                transition: 'all 0.3s ease'
              }}
              onMouseOver={(e) => {
                e.target.style.transform = 'translateY(-2px)'
                e.target.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.4)'
              }}
              onMouseOut={(e) => {
                e.target.style.transform = 'translateY(0)'
                e.target.style.boxShadow = 'none'
              }}
            >
              Stäng
            </button>
          </div>
        </div>
      )}
      </div>

      <div style={{
        marginTop: '25px',
        textAlign: 'center',
        color: 'white',
        fontSize: '14px',
        fontWeight: '500',
        opacity: 0.9
      }}>
        <p style={{ margin: '0' }}>
          {dateTime.toLocaleDateString('sv-SE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
        <p style={{ margin: '5px 0 0 0', fontSize: '18px', fontWeight: '600' }}>
          {dateTime.toLocaleTimeString('sv-SE')}
        </p>
      </div>
    </div>
  )
}

export default App