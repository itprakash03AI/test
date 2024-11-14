import streamlit as st
import plotly.express as px
import pandas as pd
import base64

# Configure the Streamlit page
st.set_page_config(
    page_title="MITR AI Analysis",
    page_icon="🤖",
    layout="wide",
    initial_sidebar_state="collapsed"
)

# AI-themed SVG icon with animations (keeping the original SVG)
AI_ICON = '''
<svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
    <style>
        @keyframes pulse {
            0% { opacity: 0.4; }
            50% { opacity: 1; }
            100% { opacity: 0.4; }
        }
        @keyframes rotate {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        @keyframes dash {
            to {
                stroke-dashoffset: 0;
            }
        }
        .brain-path {
            fill: none;
            stroke: #4a90e2;
            stroke-width: 2;
            stroke-dasharray: 1000;
            stroke-dashoffset: 1000;
            animation: dash 3s ease-in-out infinite alternate;
        }
        .circle {
            animation: pulse 2s infinite;
        }
        .rotating-circles {
            animation: rotate 10s linear infinite;
        }
        .node {
            fill: #4a90e2;
            animation: pulse 2s infinite;
        }
    </style>
    
    <defs>
        <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#2193b0;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#6dd5ed;stop-opacity:1" />
        </linearGradient>
    </defs>
    <circle cx="100" cy="100" r="90" fill="none" stroke="url(#grad1)" stroke-width="4"/>
    
    <g class="rotating-circles" transform="translate(100,100)">
        <circle class="circle" cx="0" cy="-60" r="10" fill="#4a90e2" opacity="0.7"/>
        <circle class="circle" cx="52" cy="-30" r="10" fill="#4a90e2" opacity="0.7"/>
        <circle class="circle" cx="52" cy="30" r="10" fill="#4a90e2" opacity="0.7"/>
        <circle class="circle" cx="0" cy="60" r="10" fill="#4a90e2" opacity="0.7"/>
        <circle class="circle" cx="-52" cy="30" r="10" fill="#4a90e2" opacity="0.7"/>
        <circle class="circle" cx="-52" cy="-30" r="10" fill="#4a90e2" opacity="0.7"/>
    </g>
    
    <path class="brain-path" d="M70,100 C80,80 120,80 130,100 S170,120 160,140 S120,160 100,150 S60,140 70,100"/>
    <path class="brain-path" d="M60,90 C70,70 130,70 140,90 S180,110 170,130 S130,150 110,140 S50,130 60,90"/>
    
    <circle cx="100" cy="100" r="20" fill="url(#grad1)"/>
    <text x="100" y="105" text-anchor="middle" fill="white" font-family="Arial" font-weight="bold" font-size="50">MITR</text>
    
    <g stroke="#4a90e2" stroke-width="1" opacity="0.5">
        <line x1="100" y1="80" x2="100" y2="40"/>
        <line x1="100" y1="120" x2="100" y2="160"/>
        <line x1="80" y1="100" x2="40" y2="100"/>
        <line x1="120" y1="100" x2="160" y2="100"/>
    </g>
</svg>
'''

# Convert SVG to base64 for embedding
AI_ICON_B64 = base64.b64encode(AI_ICON.encode()).decode()

# Custom CSS for styling
st.markdown("""
    <style>
    .main {
        padding: 2rem;
    }
    .mitr-container {
        background: linear-gradient(135deg, #1a2980, #26d0ce);
        border-radius: 20px;
        padding: 2rem;
        margin: auto;
        width: 600px;
        height: 500px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        cursor: pointer;
        transition: transform 0.3s ease, box-shadow 0.3s ease;
        box-shadow: 0 10px 20px rgba(0,0,0,0.1);
    }
    .mitr-container:hover {
        transform: translateY(-5px);
        box-shadow: 0 15px 30px rgba(0,0,0,0.2);
    }
    .mitr-text {
        color: white;
        font-size: 2rem;
        font-weight: bold;
        text-align: center;
        margin-top: 1rem;
    }
    .ai-badge {
        background: rgba(255,255,255,0.1);
        padding: 0.5rem 1rem;
        border-radius: 20px;
        color: white;
        font-size: 0.8rem;
        margin-top: 0.5rem;
    }
    .box-container {
        display: flex;
        justify-content: center;
        gap: 2rem;
        margin-top: 2rem;
        width: 100%;
        padding: 20px;
    }
    .stButton {
        background: none;
        border: none;
        padding: 0;
        width: 250px;
    }
    .stButton > button {
        width: 100%;
        height: 100%;
        padding: 0;
        background: none;
        border: none;
    }
    .clickable-box {
        background: linear-gradient(135deg, #1a2980, #26d0ce);
        border-radius: 15px;
        padding: 1.5rem;
        width: 100%;
        height: 150px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        cursor: pointer;
        transition: transform 0.3s ease, box-shadow 0.3s ease;
        box-shadow: 0 5px 15px rgba(0,0,0,0.1);
    }
    .clickable-box:hover {
        transform: translateY(-5px);
        box-shadow: 0 10px 25px rgba(0,0,0,0.2);
    }
    .box-title {
        color: white;
        font-size: 1.5rem;
        font-weight: bold;
        margin-bottom: 0.5rem;
    }
    .box-subtitle {
        color: rgba(255,255,255,0.8);
        font-size: 0.9rem;
        text-align: center;
    }
    button {
        all: unset;
        width: 100%;
        height: 100%;
        cursor: pointer;
    }
    </style>
    """, unsafe_allow_html=True)

def handle_click(page):
    st.session_state.page = page
    st.experimental_rerun()

# Session state to track pages
if 'page' not in st.session_state:
    st.session_state.page = 'home'

def show_home():
    # Center container
    col1, col2, col3 = st.columns([1, 2, 1])
    
    with col2:
        # MITR AI Icon with animations
        st.markdown(f'''
            <div class="mitr-container">
                <img src="data:image/svg+xml;base64,{AI_ICON_B64}" width="400" height="400">
                <div class="ai-badge">AI Powered Analysis</div>
            </div>
            
            <div class="box-container">
            <div>
                <button onclick="window.location.href='?page=analysis'">
                    <div class="clickable-box">
                        <div class="box-title">Trial Balance Analysis</div>
                        <div class="box-subtitle"> </div>
                    </div>
                </button>
                </div>
                 <div>
                <button onclick="window.location.href='?page=reports'">
                    <div class="clickable-box">
                        <div class="box-title">SAP Account Analysis</div>
                        <div class="box-subtitle"> </div>
                    </div>
                </button>
            </div>

               <div>
                <button onclick="window.location.href='?page=reports'">
                    <div class="clickable-box">
                        <div class="box-title">More...</div>
                        <div class="box-subtitle"> </div>
                    </div>
                </button>
            </div>

            </div>
            ''', unsafe_allow_html=True)

        # Hidden state management
        if st.session_state.get('page') == 'analysis':
            handle_click('analysis')
        elif st.session_state.get('page') == 'reports':
            handle_click('reports')

def show_analysis():
    st.title("AI-Powered TB Analysis Dashboard")
    
    # Add a back button
    if st.button("← Back to Home"):
        st.session_state.page = 'home'
        st.experimental_rerun()
    
    # Sample data for demonstration
    data = {
        'Month': ['Jan', 'Feb', 'Mar', 'Apr', 'May'],
        'Cases': [120, 150, 140, 170, 190],
        'Recovery': [100, 130, 120, 150, 160],
        'AI_Prediction': [125, 155, 145, 175, 195]
    }
    df = pd.DataFrame(data)
    
    # Create two columns for different charts
    col1, col2 = st.columns(2)
    
    with col1:
        st.subheader("TB Cases Analysis with AI Predictions")
        fig1 = px.line(df, x='Month', y=['Cases', 'AI_Prediction'], 
                      markers=True, 
                      labels={'value': 'Number of Cases', 'variable': 'Type'},
                      color_discrete_map={'Cases': '#4a90e2', 'AI_Prediction': '#26d0ce'})
        st.plotly_chart(fig1, use_container_width=True)
    
    with col2:
        st.subheader("Recovery Rate Trends")
        recovery_rate = [r/c*100 for r, c in zip(df['Recovery'], df['Cases'])]
        fig2 = px.bar(x=df['Month'], y=recovery_rate, 
                     labels={'x': 'Month', 'y': 'Recovery Rate (%)'},
                     color_discrete_sequence=['#1a2980'])
        st.plotly_chart(fig2, use_container_width=True)
    
    # Key metrics with AI insights
    st.subheader("AI-Enhanced Metrics")
    metric1, metric2, metric3, metric4 = st.columns(4)
    with metric1:
        st.metric("Total Cases", f"{sum(df['Cases'])}", 
                 delta=f"{((df['Cases'].iloc[-1] - df['Cases'].iloc[0])/df['Cases'].iloc[0]*100):.1f}%")
    with metric2:
        st.metric("Recovery Rate", f"{(sum(df['Recovery'])/sum(df['Cases'])*100):.1f}%", 
                 delta="2.3%")
    with metric3:
        st.metric("AI Prediction Accuracy", "96.8%", 
                 delta="1.2%")
    with metric4:
        st.metric("Risk Level", "Moderate", 
                 delta="Decreasing")

def show_reports():
    st.title("Reports Dashboard")
    
    # Add a back button
    if st.button("← Back to Home"):
        st.session_state.page = 'home'
        st.experimental_rerun()
    
    st.write("Reports dashboard content goes here...")

# Main app logic
if st.session_state.page == 'home':
    show_home()
elif st.session_state.page == 'analysis':
    show_analysis()
elif st.session_state.page == 'reports':
    show_reports()
